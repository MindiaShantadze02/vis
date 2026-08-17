import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { executeRefund } from '../_shared/payments/index.ts'
import { sendSms, refundUpdateBody } from '../_shared/sms/index.ts'

// Refunds an online charge on an appointment, for a business admin.
//
// Two shapes, one function:
//   * STANDALONE (no new_status)  — the dashboard's Refund button. The money is
//     returned; whether the booking is cancelled is decided HERE, not by the
//     client: a still-live (approved) booking is cancelled and its slot freed,
//     while a completed / no_show / already-cancelled one keeps its status so
//     history — and the billable count — is not rewritten.
//   * COMBINED (new_status: 'cancelled' | 'rejected') — the cancel dialog's
//     "refund the customer" checkbox. Unchanged, and still requires an approved
//     appointment. Kept because "cancel and refund atomically" is its own
//     intent: a refund failure reverts the cancel, so booking-state and
//     money-state only ever move together.
//
// Also `mode: 'quote'` — a read-only eligibility + amount lookup, so the confirm
// dialog can show what will actually be returned without opening payment_log to
// org members (it also holds the platform's subscription charges).
//
// Sequencing inside:
//   1. authorize (JWT → org membership),
//   2. eligibility, then READ payment_log — a missing charge is a permanent
//      condition, so it must be caught before anything is mutated,
//   3. atomically claim the appointment (payment_status paid|deposit_paid →
//      'refunded'; the WHERE guard makes concurrent double-clicks lose),
//   4. write a 'pending' appointment_refunds row — BEFORE the gateway call, so a
//      crash mid-refund leaves a reconcilable trace rather than nothing,
//   5. refund through the provider seam (payment_log 'paid' → 'refunded'),
//   6. on failure: mark the audit row failed and revert step 3 exactly.
// If we die between 3 and 5 the appointment says 'refunded' while payment_log
// still says 'paid'; that mismatch, and the lingering 'pending' audit row, are
// the reconciliation signals for a manual fix-up.
//
// Errors: invalid_request 400 · unauthorized 401 · not_authorized 403 ·
// not_found 404 · not_refundable / not_cancellable / charge_not_found /
// already_refunded 409 · refund_failed 502 · refund_unavailable 503
// (provider stub — BOG/TBC not wired yet).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Payment states that mean money actually reached the gateway. */
const REFUNDABLE_PAYMENT_STATES = ['paid', 'deposit_paid']

const MAX_REASON_LEN = 200

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
    const newStatus: string | null = body.new_status ?? null
    const mode: string = body.mode ?? 'execute'
    const adminNote: string | null =
      typeof body.admin_note === 'string' && body.admin_note.trim()
        ? body.admin_note.trim()
        : null
    const reason: string | null =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null

    if (!appointmentId) return err('invalid_request', 400)
    if (mode !== 'quote' && mode !== 'execute') return err('invalid_request', 400)
    // Only 'cancelled' is reachable from the UI today (paid-online appointments
    // are born approved, so reject never sees one); 'rejected' is accepted for
    // future-proofing. Omitted entirely = the standalone path.
    if (newStatus !== null && newStatus !== 'cancelled' && newStatus !== 'rejected') {
      return err('invalid_request', 400)
    }
    if (reason && reason.length > MAX_REASON_LEN) return err('invalid_request', 400)

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

    // ── Eligibility ──────────────────────────────────────────────────────────
    // Money-side only: an online charge that reached the gateway and hasn't been
    // returned. The appointment's status does NOT gate a standalone refund —
    // that is the whole point of the feature.
    if (appt.payment_status === 'refunded') {
      return mode === 'quote'
        ? Response.json({ ok: true, refundable: false, code: 'already_refunded' }, { headers: corsHeaders })
        : err('already_refunded', 409)
    }
    if (
      appt.payment_method !== 'online'
      || !REFUNDABLE_PAYMENT_STATES.includes(appt.payment_status)
      || !appt.payment_reference
    ) {
      return mode === 'quote'
        ? Response.json({ ok: true, refundable: false, code: 'not_refundable' }, { headers: corsHeaders })
        : err('not_refundable', 409)
    }
    // The combined path still only makes sense on a live booking.
    if (newStatus !== null && appt.status !== 'approved') return err('not_cancellable', 409)

    // The charge amount comes from payment_log (what was actually charged),
    // never the current service price — prices change after booking, and for a
    // deposit the service price is simply the wrong number. Read BEFORE any
    // mutation: a missing charge can never succeed, so there is nothing to
    // claim-then-revert.
    const { data: log } = await admin
      .from('payment_log')
      .select('id, amount, currency, provider')
      .eq('provider_reference', appt.payment_reference)
      .maybeSingle()
    if (!log) {
      return mode === 'quote'
        ? Response.json({ ok: true, refundable: false, code: 'charge_not_found' }, { headers: corsHeaders })
        : err('charge_not_found', 409)
    }

    // numeric comes back as a string via PostgREST — coerce.
    const amount = Number(log.amount)
    const currency = log.currency ?? 'GEL'

    if (mode === 'quote') {
      return Response.json(
        {
          ok: true,
          refundable: true,
          amount,
          currency,
          // Lets the dialog warn that confirming will also free the slot.
          will_cancel: appt.status === 'approved',
          is_deposit: appt.payment_status === 'deposit_paid',
        },
        { headers: corsHeaders },
      )
    }

    // ── Execute ──────────────────────────────────────────────────────────────
    // A standalone refund cancels only a still-live booking; a completed or
    // no-show visit keeps its status (see the header).
    const cancelTo = newStatus ?? (appt.status === 'approved' ? 'cancelled' : null)
    const priorStatus = appt.status
    const priorPayment = appt.payment_status

    // Atomic claim: the payment_status guard makes a concurrent second call
    // update 0 rows and bail, so the gateway is never hit twice.
    const { data: claimed } = await admin
      .from('appointments')
      .update({
        payment_status: 'refunded',
        ...(cancelTo ? { status: cancelTo } : {}),
        admin_notes: adminNote ?? appt.admin_notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .in('payment_status', REFUNDABLE_PAYMENT_STATES)
      .select('id')
    if (!claimed || claimed.length === 0) return err('already_refunded', 409)

    // Audit row first, so a crash between here and the gateway response is
    // visible as a stuck 'pending' rather than leaving no record at all.
    const { data: auditRow } = await admin
      .from('appointment_refunds')
      .insert({
        org_id: appt.org_id,
        appointment_id: appt.id,
        amount,
        currency,
        provider: log.provider ?? 'unknown',
        provider_reference: appt.payment_reference,
        status: 'pending',
        initiated_by: user.id,
        initiated_by_name: user.user_metadata?.full_name ?? user.phone ?? user.email ?? null,
        initiated_via: 'admin',
        reason,
        cancelled_appointment: !!cancelTo,
      })
      .select('id')
      .maybeSingle()

    let refundReference: string
    try {
      const result = await executeRefund(admin, {
        providerReference: appt.payment_reference,
        amount,
        currency,
        note: reason ?? undefined,
      })
      refundReference = result.refundReference
    } catch (refundErr) {
      const msg = refundErr instanceof Error ? refundErr.message : String(refundErr)
      // Money did NOT move — put the appointment back exactly as it was. Note
      // priorPayment, not a hardcoded 'paid': reverting a deposit refund to
      // 'paid' would silently promote a part-paid booking to fully paid.
      await admin
        .from('appointments')
        .update({
          payment_status: priorPayment,
          status: priorStatus,
          admin_notes: appt.admin_notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appointmentId)
      if (auditRow) {
        await admin
          .from('appointment_refunds')
          .update({ status: 'failed', error: msg, updated_at: new Date().toISOString() })
          .eq('id', auditRow.id)
      }
      console.error('[refund-payment] refund failed:', msg)
      // provider_not_configured = BOG/TBC selected but refunds not wired yet —
      // an operational state, not a gateway failure.
      return err(msg === 'provider_not_configured' ? 'refund_unavailable' : 'refund_failed',
        msg === 'provider_not_configured' ? 503 : 502)
    }

    if (auditRow) {
      // 'succeeded' means the gateway ACCEPTED the refund — a real provider
      // still settles over days.
      await admin
        .from('appointment_refunds')
        .update({
          status: 'succeeded',
          refund_reference: refundReference,
          updated_at: new Date().toISOString(),
        })
        .eq('id', auditRow.id)
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
            amount,
            currency,
            // Don't tell someone their booking was cancelled when it wasn't.
            cancelled: !!cancelTo,
          }),
        })
      }
    } catch (smsErr) {
      console.error('[refund-payment] refund SMS failed:', smsErr)
    }

    return Response.json(
      {
        ok: true,
        appointment_id: appt.id,
        refund_reference: refundReference,
        amount,
        currency,
        cancelled: !!cancelTo,
      },
      { headers: corsHeaders },
    )
  } catch (e) {
    console.error('[refund-payment] unhandled:', e)
    return err('server_error', 500)
  }
})
