import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendSms, passwordResetCodeBody } from '../_shared/sms/index.ts'
import { clientIp, generateCode, hashCode, normalizeGeorgianPhone } from '../_shared/otp.ts'

// Step 1 of phone-OTP password recovery. Generates a one-time code, stores its
// hash, and texts it to the user (mock provider for now). The code is never
// returned in the response. Public (verify_jwt=false).
//
// Privacy: the response is ALWAYS { ok: true } — invalid phone, no matching
// account, or a too-soon resend all return ok without revealing which. A code
// is only ever sent when an account actually exists for the phone.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_COOLDOWN_SECONDS = 60
const CODE_TTL_MINUTES = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone } = await req.json().catch(() => ({}))
    const local = normalizeGeorgianPhone(phone)
    if (!local) {
      // Neutral: don't reveal that the input was unusable.
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    const secret = Deno.env.get('OTP_HASH_SECRET')
    if (!secret) {
      return Response.json({ error: 'server_misconfigured' }, { status: 500, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Only send to a phone that actually has an account. No account → return ok
    // and do nothing (neutral; doesn't leak whether the number is registered).
    const { data: userId } = await supabase.rpc('auth_user_id_by_phone', { p_local: local })
    if (!userId) {
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // Rate-limit: silently skip if a code was issued for this phone very recently.
    const since = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000).toISOString()
    const { count } = await supabase
      .from('password_reset_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('phone', local)
      .gte('created_at', since)
    if ((count ?? 0) > 0) {
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // Volume caps (per-IP, per-phone, global) — anti SMS-pumping (migration
    // 070). Neutral response either way: a limited caller learns nothing.
    const ip = clientIp(req)
    const { data: limited, error: rlErr } = await supabase
      .rpc('check_otp_rate_limit', { p_phone: local, p_ip: ip })
    if (rlErr || limited) {
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    const code = generateCode()
    const code_hash = await hashCode(code, local, secret)
    const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

    const { error: insErr } = await supabase
      .from('password_reset_verifications')
      .insert({ phone: local, code_hash, expires_at, request_ip: ip })
    if (insErr) {
      return Response.json({ error: insErr.message }, { status: 500, headers: corsHeaders })
    }

    // Logged in sms_log + delivered by the active provider (mock: console only).
    await sendSms(supabase, {
      orgId: null,
      messageType: 'verification_code',
      to: local,
      body: passwordResetCodeBody(code),
    })

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
