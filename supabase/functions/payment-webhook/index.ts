import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { finalizePaymentLog, getPaymentProvider } from '../_shared/payments/index.ts'

// Settles a payment and applies its side effects:
//   * appointment  paid  → payment_status='paid', status='approved'
//                          (the pending→approved UPDATE fires the approval SMS)
//   * subscription paid  → subscription_payments='paid' + org tier/expiry updated
//                          (the tier change resets the usage anchor via trigger)
//
// Real gateways call this with a signed callback (verified against
// PAYMENT_WEBHOOK_SECRET). The mock checkout page calls the mock branch below.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ DEV/MOCK ONLY: the 'mock' branch trusts an unauthenticated outcome from   │
// │ the browser. It is gated to only act while the mock provider is active    │
// │ and only flips a row whose payment_reference matches, but it is still a   │
// │ backdoor. Before real go-live, remove it (or fold it behind a real        │
// │ signature) — same caution as the temporary OTP master code.              │
// └─────────────────────────────────────────────────────────────────────────┘

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-payment-secret',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const provider = body.provider as string
    const purpose = body.purpose as string
    const id = body.id as string
    const ref = body.ref as string
    const outcome = body.outcome as string

    if (!purpose || !id || !ref || (outcome !== 'paid' && outcome !== 'failed')) {
      return Response.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // --- Authorization ------------------------------------------------------
    if (provider === 'mock') {
      // The mock branch trusts an unauthenticated browser outcome, so it is
      // double-gated: it requires an explicit ALLOW_MOCK_PAYMENTS opt-in AND that
      // mock is still the active provider. Production deployments leave
      // ALLOW_MOCK_PAYMENTS unset, which disables this path entirely. Remove this
      // branch once a real gateway with signature verification is wired in.
      if (Deno.env.get('ALLOW_MOCK_PAYMENTS') !== 'true') {
        return Response.json({ error: 'mock_disabled' }, { status: 403, headers: corsHeaders })
      }
      const active = await getPaymentProvider(admin)
      if (active.name !== 'mock') {
        return Response.json({ error: 'mock_disabled' }, { status: 403, headers: corsHeaders })
      }
    } else {
      // Real provider callback: shared-secret gate.
      // ⚠️ GO-LIVE: a static shared secret is NOT what BOG/TBC send — before real
      // payments launch, replace this with per-provider cryptographic signature
      // verification of the raw callback body (HMAC/RSA over the gateway payload).
      const expected = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
      if (!expected || req.headers.get('x-payment-secret') !== expected) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
      }
    }

    // For a real gateway, never trust `outcome` alone: the callback must also
    // carry the charged amount/currency, and they must match what we recorded
    // when starting checkout. (Mock is dev-only and exempt.) Verified per-purpose
    // below against the stored pending_bookings / subscription_payments amount.
    const isRealProvider = provider !== 'mock'
    const claimedAmount = body.amount != null ? Number(body.amount) : null
    const claimedCurrency = typeof body.currency === 'string' ? body.currency : null
    const amountMatches = (expected: number, currency: string): boolean =>
      claimedAmount != null
      && Math.abs(claimedAmount - Number(expected)) < 0.005
      && (claimedCurrency == null || claimedCurrency === currency)

    // --- Apply side effects -------------------------------------------------
    if (purpose === 'appointment') {
      // The booking is parked in pending_bookings; the appointment only exists
      // after a successful charge. On failure nothing is ever created.
      const { data: pb } = await admin
        .from('pending_bookings')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (!pb || pb.payment_reference !== ref) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders })
      }
      // Already settled (e.g. duplicate callback) — idempotent. Report the
      // booking's actual fate, not the (possibly different) requested outcome.
      if (pb.status !== 'pending') {
        return Response.json(
          { ok: true, outcome: pb.status === 'consumed' ? 'paid' : 'failed' },
          { headers: corsHeaders },
        )
      }

      if (outcome !== 'paid') {
        await admin.from('pending_bookings').update({ status: 'failed' }).eq('id', id)
        await finalizePaymentLog(admin, ref, 'failed')
        return Response.json({ ok: true, outcome: 'failed' }, { headers: corsHeaders })
      }

      // Real gateway must have charged exactly what we parked. A mismatch means a
      // tampered/mis-routed callback — never fulfil it.
      if (isRealProvider && !amountMatches(Number(pb.amount), pb.currency ?? 'GEL')) {
        await admin.from('pending_bookings').update({ status: 'failed' }).eq('id', id)
        await finalizePaymentLog(admin, ref, 'failed', 'amount_mismatch')
        return Response.json({ error: 'amount_mismatch' }, { status: 422, headers: corsHeaders })
      }

      // Paid → create the real customer + appointment now. The appointment
      // insert consumes the verified OTP (enforce_booking_verification trigger)
      // and fires the approval SMS + admin notification.
      // Plain insert — customers has no unique constraint on phone_number, and
      // the rest of the app (in-person booking) creates a fresh customer row
      // per booking too, so we stay consistent rather than dedupe by phone.
      const { data: customer, error: custErr } = await admin
        .from('customers')
        .insert({
          first_name: pb.first_name,
          last_name: pb.last_name,
          phone_number: pb.phone,
          consent_accepted_at: pb.consent_accepted_at ?? null,
          consent_version: pb.consent_version ?? null,
        })
        .select('id')
        .single()

      let apptId: string | null = null
      let fulfilErr = custErr?.message ?? null
      if (customer) {
        const { data: appt, error: apptErr } = await admin
          .from('appointments')
          .insert({
            org_id: pb.org_id,
            service_id: pb.service_id,
            customer_id: customer.id,
            scheduled_at: pb.scheduled_at,
            duration_minutes: pb.duration_minutes,
            staff_id: pb.staff_id,
            status: 'approved',
            payment_method: 'online',
            payment_status: 'paid',
            payment_provider: pb.payment_provider,
            payment_reference: pb.payment_reference,
            notes: pb.notes,
          })
          .select('id')
          .single()
        apptId = appt?.id ?? null
        fulfilErr = apptErr?.message ?? fulfilErr
      }

      if (!apptId) {
        // Charge succeeded but the booking couldn't be created (e.g. the slot
        // was taken or the limit hit during checkout). Flag for follow-up/refund.
        await admin.from('pending_bookings').update({ status: 'failed' }).eq('id', id)
        await finalizePaymentLog(admin, ref, 'failed', fulfilErr ?? undefined)
        // Detail is recorded in payment_log for refund reconciliation; not echoed
        // to the caller so internal DB errors don't leak.
        console.error('[payment-webhook] fulfilment_failed:', fulfilErr)
        return Response.json({ error: 'fulfilment_failed' }, { status: 409, headers: corsHeaders })
      }

      await admin.from('pending_bookings').update({ status: 'consumed' }).eq('id', id)
      await admin.from('payment_log').update({ appointment_id: apptId }).eq('provider_reference', ref)
      await finalizePaymentLog(admin, ref, 'paid')
      return Response.json({ ok: true, outcome: 'paid', appointment_id: apptId }, { headers: corsHeaders })
    }

    if (purpose === 'subscription') {
      const { data: sub } = await admin
        .from('subscription_payments')
        .select('id, org_id, tier, status, period_end, payment_reference, amount, currency')
        .eq('id', id)
        .maybeSingle()
      if (!sub || sub.payment_reference !== ref) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders })
      }
      if (sub.status === 'pending') {
        if (outcome === 'paid') {
          // Real gateway must have charged the recorded tier price.
          if (isRealProvider && !amountMatches(Number(sub.amount), sub.currency ?? 'GEL')) {
            await admin.from('subscription_payments').update({ status: 'failed' }).eq('id', id)
            await finalizePaymentLog(admin, ref, 'failed', 'amount_mismatch')
            return Response.json({ error: 'amount_mismatch' }, { status: 422, headers: corsHeaders })
          }
          await admin
            .from('subscription_payments')
            .update({ status: 'paid' })
            .eq('id', id)
          // Apply the upgrade. The tier-change trigger resets the usage anchor.
          await admin
            .from('organisations')
            .update({ subscription_tier: sub.tier, subscription_expires_at: sub.period_end })
            .eq('id', sub.org_id)
        } else {
          await admin
            .from('subscription_payments')
            .update({ status: 'failed' })
            .eq('id', id)
        }
      }
      await finalizePaymentLog(admin, ref, outcome === 'paid' ? 'paid' : 'failed')
      return Response.json({ ok: true, outcome }, { headers: corsHeaders })
    }

    return Response.json({ error: 'invalid_purpose' }, { status: 400, headers: corsHeaders })
  } catch (err) {
    console.error('[payment-webhook] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
