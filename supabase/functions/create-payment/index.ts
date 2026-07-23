import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { startCheckout } from '../_shared/payments/index.ts'
import { resolveDeposit, computeDeposit, depositKind } from '../_shared/deposit.ts'

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

const VALID_TIERS = ['solo', 'team']

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

      // Org must still be within its plan limit.
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
        console.error('[create-payment] subscription_payments insert:', subErr)
        return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
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

    // -------------------------------------------------------------------
    // Credit: business buys additional booking credit (authenticated).
    // Hardened against an attacker charging a card via repeated requests:
    //   * auth-gated (must be a member of the org),
    //   * price comes from platform_config.credit_packs, never the client,
    //   * an idempotency_key (UNIQUE per org) makes a resubmit reuse the same
    //     purchase row instead of starting a second charge,
    //   * a short rate window blocks rapid-fire distinct-key spam.
    // -------------------------------------------------------------------
    if (purpose === 'credit') {
      const orgId = body.org_id as string
      const packId = body.pack_id as string
      const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : ''
      if (!orgId || !packId || !idempotencyKey || idempotencyKey.length > 100) {
        return Response.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders })
      }

      // Authenticate the caller and confirm org membership.
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

      // Resolve the pack (price + credits) SERVER-SIDE. The client never sends
      // an amount, so it can't be tampered with.
      const { data: cfg } = await admin
        .from('platform_config')
        .select('credit_packs')
        .eq('id', 1)
        .maybeSingle()
      const packs = (cfg?.credit_packs as Array<{ id: string; credits: number; price: number }> | null) ?? []
      const pack = packs.find(p => p.id === packId)
      if (!pack || !(Number(pack.price) > 0) || !(Number(pack.credits) > 0)) {
        return Response.json({ error: 'invalid_pack' }, { status: 422, headers: corsHeaders })
      }

      // Idempotency: a repeat of the SAME key reuses the existing purchase row
      // (no second charge). A key that already settled must not be reused.
      const { data: existing } = await admin
        .from('credit_purchases')
        .select('id, status')
        .eq('org_id', orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (existing && existing.status === 'paid') {
        return Response.json({ error: 'already_settled' }, { status: 409, headers: corsHeaders })
      }

      let purchaseId = existing?.id ?? null
      if (!purchaseId) {
        // New intent — rate-limit rapid-fire purchases (distinct keys) so a
        // script can't spin up many pending charges at once.
        const { count: recent } = await admin
          .from('credit_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('status', 'pending')
          .gt('created_at', new Date(Date.now() - 15_000).toISOString())
        if ((recent ?? 0) >= 2) {
          return Response.json({ error: 'too_many_requests' }, { status: 429, headers: corsHeaders })
        }

        const { data: created, error: insErr } = await admin
          .from('credit_purchases')
          .insert({
            org_id: orgId,
            credits: pack.credits,
            amount: pack.price,
            currency: 'GEL',
            status: 'pending',
            idempotency_key: idempotencyKey,
          })
          .select('id')
          .single()
        if (insErr || !created) {
          // A concurrent request may have inserted the same key first — fetch it.
          const { data: race } = await admin
            .from('credit_purchases')
            .select('id, status')
            .eq('org_id', orgId)
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle()
          if (!race) {
            console.error('[create-payment] credit_purchases insert:', insErr)
            return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
          }
          if (race.status === 'paid') {
            return Response.json({ error: 'already_settled' }, { status: 409, headers: corsHeaders })
          }
          purchaseId = race.id
        } else {
          purchaseId = created.id
        }
      }

      const checkout = await startCheckout(admin, {
        orgId,
        purpose: 'credit',
        amount: Number(pack.price),
        currency: 'GEL',
        description: `${pack.credits} booking credits`,
        referenceId: purchaseId,
        returnBaseUrl,
      })

      await admin
        .from('credit_purchases')
        .update({ payment_provider: checkout.provider, payment_reference: checkout.providerReference })
        .eq('id', purchaseId)

      return Response.json({ checkoutUrl: checkout.checkoutUrl }, { headers: corsHeaders })
    }

    // -------------------------------------------------------------------
    // Package: business sells a session package (abonement) to a customer
    // (authenticated). Same purchase-safety shape as 'credit': auth-gated,
    // server-defined price (from the packages row, never the client), and an
    // idempotency_key (UNIQUE per org on customer_packages) so a resubmit reuses
    // the same sold-package row instead of starting a second charge. The
    // customer + customer_packages row are created here as a PENDING sale;
    // payment-webhook flips it to 'paid' (and stamps expiry) once the charge
    // clears. Owner-side only — never reached from the guest booking flow.
    // -------------------------------------------------------------------
    if (purpose === 'package') {
      const orgId = body.org_id as string
      const packageId = body.package_id as string
      const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : ''
      const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : ''
      const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : ''
      if (!orgId || !packageId || !idempotencyKey || idempotencyKey.length > 100) {
        return Response.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders })
      }

      // Authenticate the caller and confirm org membership.
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

      // Resolve the package (price + session count) SERVER-SIDE from the org's
      // active catalogue. The client never sends an amount.
      const { data: pkg } = await admin
        .from('packages')
        .select('id, session_count, price, active')
        .eq('id', packageId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!pkg || !pkg.active || !(Number(pkg.price) > 0) || !(Number(pkg.session_count) > 0)) {
        return Response.json({ error: 'invalid_package' }, { status: 422, headers: corsHeaders })
      }

      // Idempotency: repeating the SAME key reuses the pending sale (no second
      // charge). A key that already settled must not be reused.
      const { data: existing } = await admin
        .from('customer_packages')
        .select('id, payment_status')
        .eq('org_id', orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (existing && existing.payment_status === 'paid') {
        return Response.json({ error: 'already_settled' }, { status: 409, headers: corsHeaders })
      }

      let customerPackageId = existing?.id ?? null
      if (!customerPackageId) {
        // New sale — a customer must be identified. Reuse an existing customer_id
        // when given (selling another pack to a known client), else create one
        // from name + phone (same shape as the recurrence writer).
        let customerId = typeof body.customer_id === 'string' ? body.customer_id : ''
        if (!customerId) {
          const phoneDigits = String(body.phone ?? '').replace(/\D/g, '')
          const phoneLocal = phoneDigits.startsWith('995') ? phoneDigits.slice(3) : phoneDigits
          if (!firstName) {
            return Response.json({ error: 'missing_fields' }, { status: 400, headers: corsHeaders })
          }
          if (!/^[345]\d{8}$/.test(phoneLocal)) {
            return Response.json({ error: 'invalid_phone' }, { status: 422, headers: corsHeaders })
          }
          const { data: createdCust, error: custErr } = await admin
            .from('customers')
            .insert({ first_name: firstName, last_name: lastName || null, phone_number: phoneLocal })
            .select('id')
            .single()
          if (custErr || !createdCust) {
            console.error('[create-payment] package customer insert:', custErr)
            return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
          }
          customerId = createdCust.id
        }

        // Rate-limit rapid-fire distinct-key sales (mirrors credit).
        const { count: recent } = await admin
          .from('customer_packages')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('payment_status', 'pending')
          .gt('created_at', new Date(Date.now() - 15_000).toISOString())
        if ((recent ?? 0) >= 2) {
          return Response.json({ error: 'too_many_requests' }, { status: 429, headers: corsHeaders })
        }

        // expires_at is stamped by settle_customer_package at settle time, so the
        // validity clock starts when the customer actually pays.
        const { data: created, error: insErr } = await admin
          .from('customer_packages')
          .insert({
            org_id: orgId,
            customer_id: customerId,
            package_id: pkg.id,
            sessions_total: pkg.session_count,
            payment_status: 'pending',
            idempotency_key: idempotencyKey,
          })
          .select('id')
          .single()
        if (insErr || !created) {
          // A concurrent request may have inserted the same key first — fetch it.
          const { data: race } = await admin
            .from('customer_packages')
            .select('id, payment_status')
            .eq('org_id', orgId)
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle()
          if (!race) {
            console.error('[create-payment] customer_packages insert:', insErr)
            return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
          }
          if (race.payment_status === 'paid') {
            return Response.json({ error: 'already_settled' }, { status: 409, headers: corsHeaders })
          }
          customerPackageId = race.id
        } else {
          customerPackageId = created.id
        }
      }

      const checkout = await startCheckout(admin, {
        orgId,
        purpose: 'package',
        amount: Number(pkg.price),
        currency: 'GEL',
        description: `${pkg.session_count} session package`,
        referenceId: customerPackageId,
        returnBaseUrl,
      })

      await admin
        .from('customer_packages')
        .update({ payment_provider: checkout.provider, payment_reference: checkout.providerReference })
        .eq('id', customerPackageId)

      return Response.json({ checkoutUrl: checkout.checkoutUrl }, { headers: corsHeaders })
    }

    return Response.json({ error: 'invalid_purpose' }, { status: 400, headers: corsHeaders })
  } catch (err) {
    console.error('[create-payment] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
