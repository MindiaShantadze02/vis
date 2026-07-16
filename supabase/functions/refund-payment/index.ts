import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { executeRefund } from '../_shared/payments/index.ts'
import { sendSms, refundUpdateBody } from '../_shared/sms/index.ts'

// Cancels a PAID online appointment and refunds the charge — one call, both
// effects. The dashboard's cancel dialog invokes this when the "refund the
// customer" checkbox is ticked (the default for paid online bookings); an
// unticked checkbox keeps using the plain status UPDATE and this function is
// never called.
//
// Why one call: if the client changed the status first and the refund then
// failed, we'd have a cancelled-but-money-kept appointment needing a separate
// retry affordance. Here a refund failure REVERTS the appointment entirely, so
// "press cancel again" is a clean retry and booking-state and money-state only
// ever move together.
//
// Sequencing inside:
//   1. authorize (JWT → org membership),
//   2. atomically claim the appointment (payment_status 'paid' → 'refunded' +
//      the new status; the WHERE payment_status='paid' guard makes concurrent
//      double-clicks lose),
//   3. refund through the provider seam (payment_log 'paid' → 'refunded'),
//   4. on refund failure revert step 2 and report.
// If we die between 2 and 4, the appointment says 'refunded' while payment_log
// still says 'paid' — that mismatch is the superadmin reconciliation signal
// for a manual fix-up.
//
// Errors: invalid_request 400 · unauthorized 401 · not_authorized 403 ·
// not_found 404 · not_refundable / already_refunded 409 · refund_failed 502 ·
// refund_unavailable 503 (provider stub — BOG/TBC not wired yet).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function err(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: corsHeaders })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Identify the caller from their JWT (delete-account pattern).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('unauthorized', 401)
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await authClient.auth.getUser()
    if (userErr || !user) return err('unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const appointmentId: string | undefined = body.appointment_id
    const newStatus: string | undefined = body.new_status
    const adminNote: string | null =
      typeof body.admin_note === 'string' && body.admin_note.trim()
        ? body.admin_note.trim()
        : null
    // Only 'cancelled' is reachable from the UI today (paid-online appointments
    // are born approved, so reject never sees one); 'rejected' is accepted for
    // future-proofing. Anything else is a bug.
    if (!appointmentId || (newStatus !== 'cancelled' && newStatus !== 'rejected')) {
      return err('invalid_request', 400)
    }

    // Service-role for everything below — authorization is re-checked here
    // against the verified caller, never trusted from the client.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: appt } = await admin
      .from('appointments')
      .select(`
        id, org_id, status, payment_method, payment_status, payment_reference, admin_notes,
        customer:customers(first_name, phone_number),
        service:services(name),
        org:organisations(name)
      `)
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appt) return err('not_found', 404)

    const { data: membership } = await admin
      .from('org_members')
      .select('id')
      .eq('org_id', appt.org_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return err('not_authorized', 403)

    // Eligibility: a live, online-paid appointment with a gateway reference.
    if (appt.payment_status === 'refunded') return err('already_refunded', 409)
    if (
      appt.payment_method !== 'online'
      || appt.payment_status !== 'paid'
      || !appt.payment_reference
      || !['pending', 'approved'].includes(appt.status)
    ) {
      return err('not_refundable', 409)
    }

    // Atomic claim: the payment_status='paid' guard makes a concurrent second
    // call update 0 rows and bail, so the gateway is never hit twice.
    const priorStatus = appt.status
    const { data: claimed } = await admin
      .from('appointments')
      .update({
        payment_status: 'refunded',
        status: newStatus,
        admin_notes: adminNote ?? appt.admin_notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('payment_status', 'paid')
      .select('id')
    if (!claimed || claimed.length === 0) return err('already_refunded', 409)

    // The charge amount comes from payment_log (what was actually charged),
    // never the current service price — prices can change after booking.
    const { data: log } = await admin
      .from('payment_log')
      .select('amount, currency')
      .eq('provider_reference', appt.payment_reference)
      .maybeSingle()

    let refundReference: string
    try {
      if (!log) throw new Error('log_not_found')
      const result = await executeRefund(admin, {
        providerReference: appt.payment_reference,
        // numeric comes back as a string via PostgREST — coerce.
        amount: Number(log.amount),
        currency: log.currency ?? 'GEL',
      })
      refundReference = result.refundReference
    } catch (refundErr) {
      // Money did NOT move — put the appointment back exactly as it was.
      await admin
        .from('appointments')
        .update({
          payment_status: 'paid',
          status: priorStatus,
          admin_notes: appt.admin_notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointmentId)
      const msg = refundErr instanceof Error ? refundErr.message : String(refundErr)
      console.error('[refund-payment] refund failed:', msg)
      // provider_not_configured = BOG/TBC selected but refunds not wired yet —
      // an operational state, not a gateway failure.
      return err(msg === 'provider_not_configured' ? 'refund_unavailable' : 'refund_failed',
        msg === 'provider_not_configured' ? 503 : 502)
    }

    // Best-effort customer SMS — a refund must never fail because a text
    // couldn't be sent (sendSms itself never throws, but stay defensive).
    try {
      // PostgREST types nested relations as arrays; normalize either shape.
      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
      const customer = one(appt.customer as { first_name: string; phone_number: string } | null)
      const service = one(appt.service as { name: string } | null)
      const org = one(appt.org as { name: string } | null)
      if (customer?.phone_number) {
        await sendSms(admin, {
          orgId: appt.org_id,
          appointmentId: appt.id,
          messageType: 'refund_update',
          to: customer.phone_number,
          body: refundUpdateBody({
            businessName: org?.name ?? 'Vis',
            serviceName: service?.name ?? '',
            amount: Number(log!.amount),
            currency: log!.currency ?? 'GEL',
          }),
        })
      }
    } catch (smsErr) {
      console.error('[refund-payment] refund SMS failed:', smsErr)
    }

    return Response.json(
      { ok: true, appointment_id: appt.id, refund_reference: refundReference },
      { headers: corsHeaders },
    )
  } catch (e) {
    console.error('[refund-payment] unhandled:', e)
    return err('server_error', 500)
  }
})
