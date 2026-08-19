import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashCode, normalizeGeorgianPhone } from '../_shared/otp.ts'

// Step 2 of phone-OTP password recovery, and the confirm step of the OTP-gated
// password change in Settings → Account. Checks the code against the most recent
// unconsumed, unexpired challenge for the phone and, on success, sets the new
// password on the matching auth user and consumes the row. Public
// (verify_jwt=false) — ownership is proven by the OTP, not a session.
//
// Deliberately carries NO '000000' test bypass (unlike verify-booking-otp): the
// same shortcut here would set the password of any account whose phone you know,
// which is account takeover for anyone holding the public anon key. The cost is
// that neither this nor the Settings → Account change can be driven end-to-end
// by a test until a real SMS provider exists.

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

    // This endpoint's attempt counter used to be bypassable by concurrency,
    // which made a 6-digit code walkable — i.e. takeover of any owner whose
    // phone number was known. The fix is the atomic per-phone budget below, not
    // check_otp_rate_limit: that one caps code ISSUANCE and is already applied
    // on the request side, where it belongs. See verify-booking-otp.

    // Resolve the target user up front: even a valid code is useless without an
    // account to update.
    //
    // Deliberately NOT reported distinctly. Step 1 (request-password-reset) goes
    // to real lengths to stay neutral about whether a phone is registered —
    // returning 'no_account' here handed that answer back for free to any
    // unauthenticated caller with a well-formed code, enumerating every
    // customer and owner phone on the platform. It falls through to the same
    // generic failure as a wrong code below.
    const { data: userId } = await supabase.rpc('auth_user_id_by_phone', { p_local: local })

    // Charge the attempt and read the challenge in ONE atomic statement — the
    // old read-then-write let concurrent guesses share a stale counter, so the
    // 5-guess budget never bound. Charging before the compare is the point.
    const { data: claim } = await supabase
      .rpc('claim_password_reset_attempt', { p_phone: local })
    const row = Array.isArray(claim) ? claim[0] : claim

    if (!row) {
      return Response.json({ ok: false, error: 'expired' }, { headers: corsHeaders })
    }
    if (row.attempts_used > MAX_ATTEMPTS) {
      return Response.json({ ok: false, error: 'too_many_attempts' }, { headers: corsHeaders })
    }

    // An unknown phone reaches here with a live challenge only if one was
    // somehow issued for it; either way the response is the generic one.
    const matches = !!userId && row.code_hash === (await hashCode(String(code), local, secret))

    if (!matches) {
      return Response.json({ ok: false, error: 'wrong_code' }, { headers: corsHeaders })
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
      .eq('id', row.challenge_id)

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    console.error('[reset-password] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
