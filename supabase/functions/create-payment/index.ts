import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { startCheckout } from '../_shared/payments/index.ts'

// Starts a payment checkout for one of two flows and returns a checkoutUrl the
// browser is redirected to. The active provider (mock for now) is resolved
// inside startCheckout; the gateway later calls payment-webhook to settle.
//
//   * appointment  — public/guest call. Pays the business for an online booking
//                    that was just inserted as pending/unpaid.
//   * subscription — authenticated org admin call. Upgrades the org's tier.
//
// Amounts are ALWAYS recomputed server-side (services.price / tier_prices) — a
// client-sent amount is never trusted. verify_jwt = false so guests can reach
// the appointment flow; the subscription flow re-checks the caller's JWT here.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALID_TIERS = ['starter', 'pro', 'business']

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

      // Org must still be within its plan limit.
      const { data: canAccept } = await admin.rpc('org_can_accept_appointment', { p_org_id: org_id })
      if (canAccept === null) {
        return Response.json({ error: 'org_not_found' }, { status: 404, headers: corsHeaders })
      }
      if (canAccept === false) {
        return Response.json({ error: 'limit_reached' }, { status: 422, headers: corsHeaders })
      }

      // Price + duration from the service (server-side; never trust the client).
      const { data: service } = await admin
        .from('services')
        .select('name, price, duration_minutes')
        .eq('id', service_id)
        .eq('org_id', org_id)
        .eq('is_active', true)
        .maybeSingle()
      if (!service) {
        return Response.json({ error: 'service_not_found' }, { status: 404, headers: corsHeaders })
      }
      const amount = Number(service.price ?? 0)
      if (!(amount > 0)) {
        return Response.json({ error: 'invalid_amount' }, { status: 422, headers: corsHeaders })
      }

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
        })
        .select('id')
        .single()
      if (intentErr || !intent) {
        return Response.json({ error: intentErr?.message ?? 'insert_failed' }, { status: 500, headers: corsHeaders })
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

    // -------------------------------------------------------------------
    // Stay: guest pays the FULL hotel stay up front. Parked in pending_stays;
    // the hotel_stays row is created by payment-webhook once the charge clears
    // (mirrors the appointment flow). Amount + availability are server-side.
    // -------------------------------------------------------------------
    if (purpose === 'stay') {
      const { org_id, room_type_id, check_in, check_out, guests, first_name, last_name, notes, slug } = body
      const phone = body.phone
      if (!org_id || !room_type_id || !check_in || !check_out || !guests || !first_name || !phone) {
        return Response.json({ error: 'missing_fields' }, { status: 400, headers: corsHeaders })
      }

      const phoneDigits = String(phone).replace(/\D/g, '')
      const phoneLocal = phoneDigits.startsWith('995') ? phoneDigits.slice(3) : phoneDigits
      if (!/^[345]\d{8}$/.test(phoneLocal)) {
        return Response.json({ error: 'invalid_phone' }, { status: 400, headers: corsHeaders })
      }

      const ci = new Date(`${check_in}T00:00:00Z`)
      const co = new Date(`${check_out}T00:00:00Z`)
      const nights = Math.round((co.getTime() - ci.getTime()) / 86_400_000)
      if (!(nights > 0)) {
        return Response.json({ error: 'invalid_dates' }, { status: 400, headers: corsHeaders })
      }

      const { data: canAccept } = await admin.rpc('org_can_accept_appointment', { p_org_id: org_id })
      if (canAccept === null) return Response.json({ error: 'org_not_found' }, { status: 404, headers: corsHeaders })
      if (canAccept === false) return Response.json({ error: 'limit_reached' }, { status: 422, headers: corsHeaders })

      // Room type: server-side price, capacity and inventory (never trust client).
      const { data: room } = await admin
        .from('resources')
        .select('name, capacity, attrs')
        .eq('id', room_type_id)
        .eq('org_id', org_id)
        .eq('kind', 'room_type')
        .eq('is_active', true)
        .maybeSingle()
      if (!room) return Response.json({ error: 'room_not_found' }, { status: 404, headers: corsHeaders })
      const attrs = (room.attrs ?? {}) as { nightly_price?: number; total_rooms?: number }
      const nightlyRate = Number(attrs.nightly_price ?? 0)
      const totalRooms = Number(attrs.total_rooms ?? 0)
      const amount = nights * nightlyRate
      if (!(amount > 0)) return Response.json({ error: 'invalid_amount' }, { status: 422, headers: corsHeaders })
      if (Number(guests) > Number(room.capacity)) {
        return Response.json({ error: 'too_many_guests' }, { status: 422, headers: corsHeaders })
      }

      // Strict availability re-check: no overbooking on ANY night of the range.
      // Count both confirmed stays and other parked (pending) intents so two
      // simultaneous checkouts can't oversell the last room.
      const { data: stays } = await admin
        .from('hotel_stays')
        .select('check_in, check_out')
        .eq('org_id', org_id).eq('room_type_id', room_type_id)
        .lt('check_in', check_out).gt('check_out', check_in)
        .not('status', 'in', '(rejected,cancelled,no_show)')
      const { data: parked } = await admin
        .from('pending_stays')
        .select('check_in, check_out')
        .eq('org_id', org_id).eq('room_type_id', room_type_id)
        .eq('status', 'pending')
        .lt('check_in', check_out).gt('check_out', check_in)
      const occupants = [...(stays ?? []), ...(parked ?? [])]
      for (let i = 0; i < nights; i++) {
        const night = ci.getTime() + i * 86_400_000
        let occ = 0
        for (const s of occupants) {
          const sIn = new Date(`${s.check_in}T00:00:00Z`).getTime()
          const sOut = new Date(`${s.check_out}T00:00:00Z`).getTime()
          if (sIn <= night && night < sOut) occ++
        }
        if (occ >= totalRooms) {
          return Response.json({ error: 'no_availability' }, { status: 422, headers: corsHeaders })
        }
      }

      // Require a verified, unconsumed, unexpired OTP for this phone.
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
      if (!otp) return Response.json({ error: 'verification_required' }, { status: 422, headers: corsHeaders })

      const { data: intent, error: intentErr } = await admin
        .from('pending_stays')
        .insert({
          org_id,
          room_type_id,
          check_in,
          check_out,
          guests: Number(guests),
          nightly_rate: nightlyRate,
          first_name: String(first_name).trim(),
          last_name: last_name ? String(last_name).trim() : null,
          phone: phoneLocal,
          notes: notes ? String(notes).trim() : null,
          amount,
          currency: 'GEL',
        })
        .select('id')
        .single()
      if (intentErr || !intent) {
        return Response.json({ error: intentErr?.message ?? 'insert_failed' }, { status: 500, headers: corsHeaders })
      }

      const checkout = await startCheckout(admin, {
        orgId: org_id,
        purpose: 'stay',
        amount,
        currency: 'GEL',
        description: room.name ?? 'Stay',
        referenceId: intent.id,
        returnBaseUrl,
        slug,
      })

      await admin
        .from('pending_stays')
        .update({ payment_provider: checkout.provider, payment_reference: checkout.providerReference })
        .eq('id', intent.id)

      return Response.json({ checkoutUrl: checkout.checkoutUrl }, { headers: corsHeaders })
    }

    // -------------------------------------------------------------------
    // Subscription: business upgrades its vis tier (authenticated).
    // -------------------------------------------------------------------
    if (purpose === 'subscription') {
      const orgId = body.org_id as string
      const tier = body.tier as string
      if (!orgId || !VALID_TIERS.includes(tier)) {
        return Response.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders })
      }

      // Authenticate the caller and confirm they belong to the org.
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
      }
      const authClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      )
      const { data: { user }, error: userErr } = await authClient.auth.getUser()
      if (userErr || !user) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
      }
      const { data: membership } = await admin
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!membership) {
        return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders })
      }

      // Price comes from platform_config, never the client.
      const { data: cfg } = await admin
        .from('platform_config')
        .select('tier_prices')
        .eq('id', 1)
        .maybeSingle()
      const amount = Number((cfg?.tier_prices as Record<string, number> | null)?.[tier] ?? 0)
      if (!(amount > 0)) {
        return Response.json({ error: 'invalid_amount' }, { status: 422, headers: corsHeaders })
      }

      // One monthly billing period from today.
      const start = new Date()
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      const periodStart = start.toISOString().slice(0, 10)
      const periodEnd = end.toISOString().slice(0, 10)

      const { data: subPay, error: subErr } = await admin
        .from('subscription_payments')
        .insert({
          org_id: orgId,
          tier,
          amount,
          currency: 'GEL',
          status: 'pending',
          period_start: periodStart,
          period_end: periodEnd,
        })
        .select('id')
        .single()
      if (subErr || !subPay) {
        return Response.json({ error: subErr?.message ?? 'insert_failed' }, { status: 500, headers: corsHeaders })
      }

      const checkout = await startCheckout(admin, {
        orgId,
        purpose: 'subscription',
        subscriptionPaymentId: subPay.id,
        amount,
        currency: 'GEL',
        description: `vis ${tier}`,
        referenceId: subPay.id,
        returnBaseUrl,
      })

      await admin
        .from('subscription_payments')
        .update({ payment_provider: checkout.provider, payment_reference: checkout.providerReference })
        .eq('id', subPay.id)

      return Response.json({ checkoutUrl: checkout.checkoutUrl }, { headers: corsHeaders })
    }

    return Response.json({ error: 'invalid_purpose' }, { status: 400, headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
