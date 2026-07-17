import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendSms, waitlistOfferBody, waitlistClaimedBody } from '../_shared/sms/index.ts'

// Cancellation-waitlist notify + claim (Phase 4). Public (verify_jwt=false).
//
// Actions:
//   * notify      {offer_id}          — SECRET-gated (from dispatch_waitlist_offers
//                                        cron): texts the offer + claim link.
//   * request-otp {token}             — texts an OTP to the offered entry's phone.
//   * claim       {token, code, lang} — verify OTP, then claim_waitlist_offer
//                                        books the slot (409 on race). Sends a
//                                        booking-confirmed SMS.
//
// OTP is delegated to request-booking-otp / verify-booking-otp server-to-server
// (phone stays server-side, no test bypass here). The claim's appointment insert
// consumes the verified challenge via enforce_booking_verification.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sms-secret',
}

function err(code: string, status: number): Response {
  return Response.json({ ok: false, error: code }, { status, headers: corsHeaders })
}

const OFFER_MINUTES = 15

function formatWhen(iso: string, lang: string): string {
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'ka-GE'
  return new Intl.DateTimeFormat(loc, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi',
  }).format(new Date(iso))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action as string
    const lang = ['ka', 'ru', 'en'].includes(body.lang) ? body.lang as string : 'ka'

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── notify (cron → SMS the offer) ─────────────────────────────────────────
    if (action === 'notify') {
      const expected = Deno.env.get('SMS_WEBHOOK_SECRET')
      if (!expected || req.headers.get('x-sms-secret') !== expected) return err('unauthorized', 401)
      const offerId = body.offer_id as string
      if (!offerId) return err('invalid_request', 400)

      const { data: o } = await admin
        .from('waitlist_offers')
        .select('id, claim_token, scheduled_at, notified_at, status, org_id, service:services(name), org:organisations(name), entry:waitlist_entries(phone)')
        .eq('id', offerId).maybeSingle()
      if (!o || o.status !== 'pending' || o.notified_at) return Response.json({ ok: true, skipped: true }, { headers: corsHeaders })
      const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
      const service = one(o.service as { name: string } | null)
      const org = one(o.org as { name: string } | null)
      const entry = one(o.entry as { phone: string } | null)
      if (!entry?.phone) return err('not_found', 404)

      const { data: cfg } = await admin.from('platform_config').select('sms_config').eq('id', 1).maybeSingle()
      const appBase = (cfg?.sms_config as { app_base_url?: string } | null)?.app_base_url ?? 'https://vis.ge'

      await sendSms(admin, {
        orgId: o.org_id, appointmentId: null, messageType: 'waitlist_offer', to: entry.phone,
        body: waitlistOfferBody({
          businessName: org?.name ?? 'Vis', serviceName: service?.name ?? '',
          when: formatWhen(o.scheduled_at, lang), claimUrl: `${appBase}/waitlist/${o.claim_token}`, minutes: OFFER_MINUTES,
        }, lang as 'ka' | 'ru' | 'en'),
      })
      await admin.from('waitlist_offers').update({ notified_at: new Date().toISOString() }).eq('id', offerId)
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // request-otp / claim both key off the claim token.
    const token = body.token as string
    if (!token || !['request-otp', 'claim'].includes(action)) return err('invalid_request', 400)

    const { data: offer } = await admin
      .from('waitlist_offers')
      .select('id, claim_token, status, expires_at, scheduled_at, org_id, service:services(name), org:organisations(name), entry:waitlist_entries(phone)')
      .eq('claim_token', token).maybeSingle()
    if (!offer) return err('not_found', 404)
    if (offer.status !== 'pending') return err('offer_invalid', 409)
    if (new Date(offer.expires_at) <= new Date()) return err('offer_expired', 409)

    const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
    const service = one(offer.service as { name: string } | null)
    const org = one(offer.org as { name: string } | null)
    const entry = one(offer.entry as { phone: string } | null)
    const phone = entry?.phone
    if (!phone) return err('not_found', 404)

    const otpBase = `${Deno.env.get('SUPABASE_URL')}/functions/v1`
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const otpHeaders = { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` }

    if (action === 'request-otp') {
      const r = await fetch(`${otpBase}/request-booking-otp`, {
        method: 'POST', headers: otpHeaders, body: JSON.stringify({ phone, org_id: offer.org_id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) {
        return Response.json({ ok: false, error: j.error ?? 'otp_request_failed' },
          { status: r.status === 429 ? 429 : 400, headers: corsHeaders })
      }
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // claim
    const code = String(body.code ?? '')
    if (!/^\d{6}$/.test(code)) return err('invalid_code', 400)
    const vr = await fetch(`${otpBase}/verify-booking-otp`, {
      method: 'POST', headers: otpHeaders, body: JSON.stringify({ phone, code }),
    })
    const vj = await vr.json().catch(() => ({}))
    if (!vj.verified) return Response.json({ ok: false, error: vj.error ?? 'wrong_code' }, { status: 401, headers: corsHeaders })

    // Books under the per-org lock; the appointment insert consumes the OTP.
    const { data: apptId, error: rpcErr } = await admin.rpc('claim_waitlist_offer', { p_token: token })
    if (rpcErr) {
      const m = rpcErr.message ?? ''
      if (m.includes('slot_taken')) return err('slot_taken', 409)
      if (m.includes('offer_expired')) return err('offer_expired', 409)
      if (m.includes('offer_invalid')) return err('offer_invalid', 409)
      console.error('[claim-waitlist] claim:', rpcErr)
      return err('server_error', 500)
    }

    await sendSms(admin, {
      orgId: offer.org_id, appointmentId: apptId as string, messageType: 'waitlist_claimed', to: phone,
      body: waitlistClaimedBody({
        businessName: org?.name ?? 'Vis', serviceName: service?.name ?? '', when: formatWhen(offer.scheduled_at, lang),
      }, lang as 'ka' | 'ru' | 'en'),
    })
    return Response.json({ ok: true, appointment_id: apptId }, { headers: corsHeaders })
  } catch (e) {
    console.error('[claim-waitlist] unhandled:', e)
    return err('server_error', 500)
  }
})
