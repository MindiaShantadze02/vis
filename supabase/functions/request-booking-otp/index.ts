import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendSms, verificationCodeBody } from '../_shared/sms/index.ts'
import { clientIp, generateCode, hashCode, normalizeGeorgianPhone } from '../_shared/otp.ts'

// Step 1 of the guest-booking phone verification. Generates a one-time code,
// stores its hash, and texts it to the customer (mock provider for now). The
// code is never returned in the response. Public (verify_jwt=false) — anyone
// can request a code for a phone they control; rate-limited per phone (60s
// cooldown) and by check_otp_rate_limit (per-IP burst/daily, per-phone daily,
// global daily — SMS-pumping protection, migration 070).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_COOLDOWN_SECONDS = 60
const CODE_TTL_MINUTES = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, org_id } = await req.json().catch(() => ({}))
    const local = normalizeGeorgianPhone(phone)
    if (!local) {
      // Expected outcome (not an HTTP error) so the client can read the flag.
      return Response.json({ ok: false, error: 'invalid_phone' }, { headers: corsHeaders })
    }

    const secret = Deno.env.get('OTP_HASH_SECRET')
    if (!secret) {
      return Response.json({ error: 'server_misconfigured' }, { status: 500, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Rate-limit: refuse if a code was already issued for this phone very recently.
    const since = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000).toISOString()
    const { count } = await supabase
      .from('booking_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('phone', local)
      .gte('created_at', since)
    if ((count ?? 0) > 0) {
      return Response.json({ ok: false, error: 'too_soon' }, { headers: corsHeaders })
    }

    // Volume caps (per-IP, per-phone, global) — anti SMS-pumping. Fail closed:
    // if the check itself errors we'd rather refuse a code than send unmetered.
    const ip = clientIp(req)
    const { data: limited, error: rlErr } = await supabase
      .rpc('check_otp_rate_limit', { p_phone: local, p_ip: ip })
    if (rlErr) {
      console.error('[request-booking-otp] rate_limit_check:', rlErr)
      return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
    }
    if (limited) {
      return Response.json({ ok: false, error: 'too_many_requests' }, { headers: corsHeaders })
    }

    const code = generateCode()
    const code_hash = await hashCode(code, local, secret)
    const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

    const { error: insErr } = await supabase
      .from('booking_verifications')
      .insert({ phone: local, code_hash, expires_at, request_ip: ip })
    if (insErr) {
      console.error('[request-booking-otp] insert:', insErr)
      return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
    }

    // Logged in sms_log + delivered by the active provider (mock: console only).
    await sendSms(supabase, {
      orgId: org_id ?? null,
      messageType: 'verification_code',
      to: local,
      body: verificationCodeBody(code),
    })

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    console.error('[request-booking-otp] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
