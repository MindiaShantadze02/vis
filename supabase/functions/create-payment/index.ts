import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { startCheckout } from '../_shared/payments/index.ts'
import { resolveDeposit, computeDeposit, depositKind } from '../_shared/deposit.ts'

// Starts a payment checkout and returns a checkoutUrl the browser is redirected
// to. The active provider (mock for now) is resolved inside startCheckout; the
// gateway later calls payment-webhook to settle.
//
//   * appointment — public/guest call. Pays the business for an online booking
//                   that was just inserted as pending/unpaid.
//
// (Post-paid usage billing charges the business monthly via a separate 'usage'
// purpose added in T1.3; the old tier/credit purchases are gone.)
//
// Amounts are ALWAYS recomputed server-side (services.price) — a client-sent
// amount is never trusted. verify_jwt = false so guests can reach the flow.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const purpose = body.purpose as string
    const returnBaseUrl = body.returnBaseUrl as string

    if (!returnBaseUrl || !/^https?:\/\//.test(returnBaseUrl)) {
      return Response.json({ error: 'invalid_return_url' }, { status: 400, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // -------------------------------------------------------------------
    // Appointment: customer pays the business for an online booking.
    // The appointment is NOT created here — its details are parked in
    // pending_bookings and only promoted to a real appointment by
    // payment-webhook once the charge clears. A failed/abandoned payment
    // therefore leaves nothing on the business's dashboard.
    // -------------------------------------------------------------------
    if (purpose === 'appointment') {
      const { org_id, service_id, scheduled_at, staff_id, first_name, last_name, notes, slug } = body
      const phone = body.phone
      // Consent (Privacy Policy + Terms) captured at the booking form; parked
      // here and carried into the customer row by payment-webhook.
      const consentVersion = body.consent_version ? String(body.consent_version) : null
      if (!org_id || !service_id || !scheduled_at || !first_name || !phone) {
        return Response.json({ error: 'missing_fields' }, { status: 400, headers: corsHeaders })
      }

      // Normalise the phone to a bare 9-digit Georgian number (matches how
      // booking_verifications and customers store it).
      const phoneDigits = String(phone).replace(/\D/g, '')
      const phoneLocal = phoneDigits.startsWith('995') ? phoneDigits.slice(3) : phoneDigits
      if (!/^[345]\d{8}$/.test(phoneLocal)) {
        return Response.json({ error: 'invalid_phone' }, { status: 400, headers: corsHeaders })
      }

      // Org must not be billing-suspended.
      const { data: canAccept } = await admin.rpc('org_can_accept_appointment', { p_org_id: org_id })
      if (canAccept === null) {
        return Response.json({ error: 'org_not_found' }, { status: 404, headers: corsHeaders })
      }
      if (canAccept === false) {
        return Response.json({ error: 'limit_reached' }, { status: 422, headers: corsHeaders })
      }

      // Price + duration + deposit from the service (server-side; never trust
      // the client).
      const { data: service } = await admin
        .from('services')
        .select('name, price, duration_minutes, deposit_type, deposit_value')
        .eq('id', service_id)
        .eq('org_id', org_id)
        .eq('is_active', true)
        .maybeSingle()
      if (!service) {
        return Response.json({ error: 'service_not_found' }, { status: 404, headers: corsHeaders })
      }
      const fullPrice = Number(service.price ?? 0)
      if (!(fullPrice > 0)) {
        return Response.json({ error: 'invalid_amount' }, { status: 422, headers: corsHeaders })
      }

      // Resolve the deposit (service override wins over the org default) and
      // compute the upfront charge. No deposit → charge the full price (the
      // existing pay-online-in-full flow). A partial deposit charges only that
      // and marks the parked row so the webhook settles it as deposit_paid.
      const { data: orgDefaults } = await admin
        .from('organisations')
        .select('deposit_type, deposit_value')
        .eq('id', org_id)
        .maybeSingle()
      const resolvedDeposit = resolveDeposit(
        { type: service.deposit_type ?? null, value: service.deposit_value != null ? Number(service.deposit_value) : null },
        { type: (orgDefaults?.deposit_type ?? 'none') as 'none' | 'fixed' | 'percent', value: orgDefaults?.deposit_value != null ? Number(orgDefaults.deposit_value) : null },
      )
      const deposit = computeDeposit(fullPrice, resolvedDeposit)
      const kind = depositKind(fullPrice, deposit)
      const amount = kind === 'none' ? fullPrice : deposit
      const isDeposit = kind === 'partial'

      // Require a verified, unconsumed, unexpired OTP for this phone BEFORE
      // charging — the appointment insert (in the webhook) consumes it.
      const { data: otp } = await admin
        .from('booking_verifications')
        .select('id')
        .eq('phone', phoneLocal)
        .not('verified_at', 'is', null)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!otp) {
        return Response.json({ error: 'verification_required' }, { status: 422, headers: corsHeaders })
      }

      // Park the booking until payment clears.
      const { data: intent, error: intentErr } = await admin
        .from('pending_bookings')
        .insert({
          org_id,
          service_id,
          scheduled_at,
          duration_minutes: service.duration_minutes,
          staff_id: staff_id ?? null,
          first_name: String(first_name).trim(),
          last_name: last_name ? String(last_name).trim() : null,
          phone: phoneLocal,
          notes: notes ? String(notes).trim() : null,
          amount,
          currency: 'GEL',
          is_deposit: isDeposit,
          consent_accepted_at: consentVersion ? new Date().toISOString() : null,
          consent_version: consentVersion,
        })
        .select('id')
        .single()
      if (intentErr || !intent) {
        console.error('[create-payment] pending_bookings insert:', intentErr)
        return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
      }

      const checkout = await startCheckout(admin, {
        orgId: org_id,
        purpose: 'appointment',
        amount,
        currency: 'GEL',
        description: service.name ?? 'Booking',
        referenceId: intent.id,
        returnBaseUrl,
        slug,
      })

      await admin
        .from('pending_bookings')
        .update({ payment_provider: checkout.provider, payment_reference: checkout.providerReference })
        .eq('id', intent.id)

      return Response.json({ checkoutUrl: checkout.checkoutUrl }, { headers: corsHeaders })
    }

    return Response.json({ error: 'invalid_purpose' }, { status: 400, headers: corsHeaders })
  } catch (err) {
    console.error('[create-payment] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
