import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashCode, normalizeGeorgianPhone } from '../_shared/otp.ts'

// Step 2 of guest-booking phone verification. Checks the code against the most
// recent unconsumed, unexpired challenge for the phone and, on success, marks it
// verified. The DB trigger enforce_booking_verification (migration 030) then lets
// the appointment insert through and consumes the row. Public (verify_jwt=false).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_ATTEMPTS = 5

// Local-dev-only test code that bypasses the hash check so booking OTP can be
// exercised without a real SMS provider (the mock provider only logs the code).
// It is gated on BOTH an explicit opt-in flag AND a local Supabase URL, so it
// can never be active in production — prod's SUPABASE_URL is the hosted
// *.supabase.co domain. See the 2026-06-24 security review: the previous
// prod-secret master-code backdoor was removed and must not be reintroduced.
const TEST_OTP_CODE = '000000'
const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'kong', 'host.docker.internal']

function testOtpBypassAllowed(): boolean {
  if (Deno.env.get('ALLOW_TEST_OTP') !== 'true') return false
  // ⚠️ TEMPORARY TESTING OVERRIDE — REMOVE WHEN A REAL SMS PROVIDER IS ADDED.
  // The owner runs a single hosted Supabase project (no separate staging) with
  // no real user data and no SMS provider yet, so the mock provider only logs
  // codes. When ALLOW_TEST_OTP_HOSTED=true we allow the '000000' bypass on the
  // hosted project too. This deliberately re-opens the hosted bypass the
  // 2026-06-24 security review closed — unset the ALLOW_TEST_OTP_HOSTED /
  // ALLOW_TEST_OTP secrets and delete this branch once SMS is live.
  // Tracked in docs/MULTI_VERTICAL_TODO.md.
  if (Deno.env.get('ALLOW_TEST_OTP_HOSTED') === 'true') return true
  try {
    const host = new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname
    return LOCAL_HOSTS.includes(host)
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, code } = await req.json().catch(() => ({}))
    const local = normalizeGeorgianPhone(phone)
    if (!local || !/^\d{6}$/.test(String(code ?? ''))) {
      return Response.json({ verified: false, error: 'invalid_input' }, { headers: corsHeaders })
    }

    const secret = Deno.env.get('OTP_HASH_SECRET')
    if (!secret) {
      return Response.json({ error: 'server_misconfigured' }, { status: 500, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // NOTE: check_otp_rate_limit is deliberately NOT called here. It caps code
    // ISSUANCE (it counts rows created per IP/phone), so applying it to the
    // verify side refuses a code the user legitimately received just because
    // their IP requested several — at the production defaults (5 per 10 min per
    // IP) that locks out everyone behind one office or cafe NAT. Brute force is
    // bounded by the per-phone attempt budget below, which the request-side cap
    // composes with: at most phone_daily codes a day, each window capped at
    // MAX_ATTEMPTS wrong guesses that a fresh code does not reset.

    // Charge the attempt and read the challenge in ONE atomic statement.
    // This replaced a read-modify-write (`attempts = row.attempts + 1`) that
    // concurrent requests all computed from the same stale value, so N parallel
    // guesses advanced the counter by 1 and the 5-guess budget never bound.
    // Charging BEFORE the comparison is the point: a burst cannot buy extras.
    const { data: claim } = await supabase
      .rpc('claim_booking_otp_attempt', { p_phone: local })
    const row = Array.isArray(claim) ? claim[0] : claim

    if (!row) {
      return Response.json({ verified: false, error: 'expired' }, { headers: corsHeaders })
    }
    if (row.attempts_used > MAX_ATTEMPTS) {
      return Response.json({ verified: false, error: 'too_many_attempts' }, { headers: corsHeaders })
    }

    const matches = (testOtpBypassAllowed() && String(code) === TEST_OTP_CODE) ||
      row.code_hash === (await hashCode(String(code), local, secret))

    if (!matches) {
      // No `remaining` — telling an attacker their exact budget helps only them.
      return Response.json({ verified: false, error: 'wrong_code' }, { headers: corsHeaders })
    }

    // Marks verified AND refunds the attempt the claim charged: a correct code
    // must not cost budget, or repeated sign-ins inside the 60s resend cooldown
    // (which re-verify the same still-live challenge) lock the user out of
    // their own account.
    await supabase.rpc('mark_booking_otp_verified', { p_id: row.challenge_id })

    return Response.json({ verified: true }, { headers: corsHeaders })
  } catch (err) {
    console.error('[verify-booking-otp] unhandled:', err)
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders })
  }
})
