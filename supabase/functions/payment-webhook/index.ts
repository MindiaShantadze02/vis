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
      // Real provider callback: shared-secret gate (signature verification would
      // be added per provider here).
      const expected = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
      if (!expected || req.headers.get('x-payment-secret') !== expected) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
      }
    }

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

      // Paid → create the real customer + appointment now. The appointment
      // insert consumes the verified OTP (enforce_booking_verification trigger)
      // and fires the approval SMS + admin notification.
      // Plain insert — customers has no unique constraint on phone_number, and
      // the rest of the app (in-person booking) creates a fresh customer row
      // per booking too, so we stay consistent rather than dedupe by phone.
      const { data: customer, error: custErr } = await admin
        .from('customers')
        .insert({ first_name: pb.first_name, last_name: pb.last_name, phone_number: pb.phone })
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
        return Response.json({ error: 'fulfilment_failed', detail: fulfilErr }, { status: 409, headers: corsHeaders })
      }

      await admin.from('pending_bookings').update({ status: 'consumed' }).eq('id', id)
      await admin.from('payment_log').update({ appointment_id: apptId }).eq('provider_reference', ref)
      await finalizePaymentLog(admin, ref, 'paid')
      return Response.json({ ok: true, outcome: 'paid', appointment_id: apptId }, { headers: corsHeaders })
    }

    if (purpose === 'stay') {
      // Parked in pending_stays; the hotel_stays row only exists after a
      // successful charge. Mirrors the appointment branch above.
      const { data: ps } = await admin
        .from('pending_stays')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (!ps || ps.payment_reference !== ref) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders })
      }
      if (ps.status !== 'pending') {
        return Response.json(
          { ok: true, outcome: ps.status === 'consumed' ? 'paid' : 'failed' },
          { headers: corsHeaders },
        )
      }

      if (outcome !== 'paid') {
        await admin.from('pending_stays').update({ status: 'failed' }).eq('id', id)
        await finalizePaymentLog(admin, ref, 'failed')
        return Response.json({ ok: true, outcome: 'failed' }, { headers: corsHeaders })
      }

      // Paid → create the customer + stay. The hotel_stays insert consumes the
      // verified OTP (trg_enforce_stay_verification) and fires the approval SMS
      // + admin bell notification.
      const { data: customer, error: custErr } = await admin
        .from('customers')
        .insert({ first_name: ps.first_name, last_name: ps.last_name, phone_number: ps.phone })
        .select('id')
        .single()

      let stayId: string | null = null
      let fulfilErr = custErr?.message ?? null
      if (customer) {
        const { data: stay, error: stayErr } = await admin
          .from('hotel_stays')
          .insert({
            org_id: ps.org_id,
            customer_id: customer.id,
            room_type_id: ps.room_type_id,
            check_in: ps.check_in,
            check_out: ps.check_out,
            guests: ps.guests,
            nightly_rate: ps.nightly_rate,
            total_amount: ps.amount,
            status: 'approved',
            payment_method: 'online',
            payment_status: 'paid',
            payment_provider: ps.payment_provider,
            payment_reference: ps.payment_reference,
            notes: ps.notes,
          })
          .select('id')
          .single()
        stayId = stay?.id ?? null
        fulfilErr = stayErr?.message ?? fulfilErr
      }

      if (!stayId) {
        // Charge cleared but the stay couldn't be created (e.g. sold out or the
        // limit hit during checkout). Flag for follow-up/refund.
        await admin.from('pending_stays').update({ status: 'failed' }).eq('id', id)
        await finalizePaymentLog(admin, ref, 'failed', fulfilErr ?? undefined)
        return Response.json({ error: 'fulfilment_failed', detail: fulfilErr }, { status: 409, headers: corsHeaders })
      }

      await admin.from('pending_stays').update({ status: 'consumed' }).eq('id', id)
      await finalizePaymentLog(admin, ref, 'paid')
      return Response.json({ ok: true, outcome: 'paid', stay_id: stayId }, { headers: corsHeaders })
    }

    if (purpose === 'subscription') {
      const { data: sub } = await admin
        .from('subscription_payments')
        .select('id, org_id, tier, status, period_end, payment_reference')
        .eq('id', id)
        .maybeSingle()
      if (!sub || sub.payment_reference !== ref) {
        return Response.json({ error: 'not_found' }, { status: 404, headers: corsHeaders })
      }
      if (sub.status === 'pending') {
        if (outcome === 'paid') {
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
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
