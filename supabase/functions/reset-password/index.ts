import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashCode, normalizeGeorgianPhone } from '../_shared/otp.ts'

// Step 2 of phone-OTP password recovery. Checks the code against the most recent
// unconsumed, unexpired challenge for the phone and, on success, sets the new
// password on the matching auth user and consumes the row. Public
// (verify_jwt=false) — ownership is proven by the OTP, not a session.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_ATTEMPTS = 5
// Keep in sync with PASSWORD_MIN in client/src/lib/validation.ts.
const MIN_PASSWORD = 8

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, code, newPassword } = await req.json().catch(() => ({}))
    const local = normalizeGeorgianPhone(phone)
    if (!local || !/^\d{6}$/.test(String(code ?? ''))) {
      return Response.json({ ok: false, error: 'invalid_input' }, { headers: corsHeaders })
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
      return Response.json({ ok: false, error: 'weak_password' }, { headers: corsHeaders })
    }

    const secret = Deno.env.get('OTP_HASH_SECRET')
    if (!secret) {
      return Response.json({ error: 'server_misconfigured' }, { status: 500, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Resolve the target user up front: even a valid code is useless without an
    // account to update. Neutral codes were never issued for unknown phones.
    const { data: userId } = await supabase.rpc('auth_user_id_by_phone', { p_local: local })
    if (!userId) {
      return Response.json({ ok: false, error: 'no_account' }, { headers: corsHeaders })
    }

    // Reject once the phone has burned through its attempts across ALL recent,
    // still-valid challenges. Counting a single row lets an attacker request a
    // fresh code to reset the 5-guess budget, so sum failures over the live
    // window (mirrors verify-booking-otp's hardening).
    const { data: liveRows } = await supabase
      .from('password_reset_verifications')
      .select('attempts')
      .eq('phone', local)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
    const totalAttempts = (liveRows ?? []).reduce((sum, r) => sum + (r.attempts ?? 0), 0)
    if (totalAttempts >= MAX_ATTEMPTS) {
      return Response.json({ ok: false, error: 'too_many_attempts' }, { headers: corsHeaders })
    }

    // Latest challenge for this phone that hasn't been used or expired.
    const { data: row } = await supabase
      .from('password_reset_verifications')
      .select('id, code_hash, attempts, expires_at')
      .eq('phone', local)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!row) {
      return Response.json({ ok: false, error: 'expired' }, { headers: corsHeaders })
    }

    const matches = row.code_hash === (await hashCode(String(code), local, secret))

    if (!matches) {
      const attempts = row.attempts + 1
      await supabase.from('password_reset_verifications').update({ attempts }).eq('id', row.id)
      return Response.json(
        { ok: false, error: 'wrong_code', remaining: Math.max(0, MAX_ATTEMPTS - attempts) },
        { headers: corsHeaders },
      )
    }

    // Set the new password on the auth user.
    const { error: updErr } = await supabase.auth.admin.updateUserById(String(userId), {
      password: newPassword,
    })
    if (updErr) {
      console.error('[reset-password] update_user:', updErr)
      return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
    }

    // Mark the challenge verified + consumed so it can't be reused.
    const now = new Date().toISOString()
    await supabase
      .from('password_reset_verifications')
      .update({ verified_at: now, consumed_at: now })
      .eq('id', row.id)

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    console.error('[reset-password] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
