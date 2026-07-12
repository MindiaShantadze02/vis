import { test, expect } from '@playwright/test'
import { readSupabaseEnv, signInSeed, uniquePhone } from './helpers'

/**
 * Rate-limiting verification. These are API-level tests (no browser): they hit
 * the hosted edge functions / PostgREST directly with `fetch`, the way an
 * abuser would, because the limits are enforced server-side and the UI adds its
 * own cooldowns on top. Each scenario is deterministic and self-cleaning.
 *
 * Covered:
 *   1. OTP resend cooldown — a 2nd code request for the same phone inside the
 *      60s window is refused (`too_soon`). (request-booking-otp)
 *   2. OTP verify lockout — 5 wrong codes exhaust the attempt budget, then
 *      further guesses are refused (`too_many_attempts`). (verify-booking-otp,
 *      MAX_ATTEMPTS = 5)
 *   3. Public API per-key/minute — a single key firing past the per-minute cap
 *      gets HTTP 429 `rate_limited`. (the `api` edge fn + authenticate_api_key)
 *
 * NOT covered here (deliberately): the SMS-pumping volume caps
 * (check_otp_rate_limit: ip_burst / ip_daily / phone_daily / global_daily,
 * migration 070). The hosted project runs them at RELAXED values (ip_burst 150,
 * phone_daily 500, …) so the '000000' test bypass + e2e don't trip them, which
 * means they can't be driven from an anon-key HTTP client without sending 150+
 * real (mock) SMS and starving the rest of the suite's OTP budget. Their logic
 * lives in the check_otp_rate_limit SQL and would need a service-role harness
 * (seed rows → call the RPC → assert the violated-limit name) or a temporarily
 * lowered config to exercise directly.
 */

const OK_BODY = 'expected ok/error JSON from the edge function'

test.describe('Rate limiting', () => {
  test('OTP: a second code request for the same phone within the cooldown is refused', async () => {
    const { url, anonKey } = readSupabaseEnv()
    const phone = uniquePhone()
    const headers = { apikey: anonKey, 'content-type': 'application/json' }
    const requestCode = () =>
      fetch(`${url}/functions/v1/request-booking-otp`, {
        method: 'POST', headers, body: JSON.stringify({ phone }),
      }).then(r => r.json())

    // First request for a fresh phone issues a code.
    const first = await requestCode()
    expect(first, OK_BODY).toBeTruthy()
    expect(first.ok, `first request should issue a code, got ${JSON.stringify(first)}`).toBe(true)

    // Immediately asking again (well inside the 60s per-phone cooldown) is
    // refused before any second SMS is sent.
    const second = await requestCode()
    expect(second.ok).toBe(false)
    expect(second.error).toBe('too_soon')
  })

  test('OTP: repeated wrong codes lock the phone out after the attempt budget', async () => {
    const { url, anonKey } = readSupabaseEnv()
    const phone = uniquePhone()
    const headers = { apikey: anonKey, 'content-type': 'application/json' }

    // Issue a real (unknown) code for a fresh phone.
    const req = await fetch(`${url}/functions/v1/request-booking-otp`, {
      method: 'POST', headers, body: JSON.stringify({ phone }),
    }).then(r => r.json())
    expect(req.ok, `code request should succeed, got ${JSON.stringify(req)}`).toBe(true)

    // '111111' is a wrong guess (not the random code, and not the '000000' test
    // bypass), so each attempt burns one from the budget of 5.
    const guess = () =>
      fetch(`${url}/functions/v1/verify-booking-otp`, {
        method: 'POST', headers, body: JSON.stringify({ phone, code: '111111' }),
      }).then(r => r.json())

    for (let i = 1; i <= 5; i++) {
      const res = await guess()
      expect(res.verified).toBe(false)
      expect(res.error, `attempt ${i} should be wrong_code, got ${JSON.stringify(res)}`).toBe('wrong_code')
    }

    // Budget spent — the 6th guess is refused outright, without even checking it.
    const locked = await guess()
    expect(locked.verified).toBe(false)
    expect(locked.error).toBe('too_many_attempts')
  })

  test('Public API: a key exceeding the per-minute limit gets HTTP 429', async () => {
    // ~130 sequential requests can outrun the default per-test timeout.
    test.setTimeout(120_000)

    const { url, anonKey, accessToken } = await signInSeed()
    const authHeaders = {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    }

    // Mint a throwaway API key for the seeded org (max 5 active; we revoke it).
    const createRes = await fetch(`${url}/rest/v1/rpc/create_api_key`, {
      method: 'POST',
      headers: { ...authHeaders, prefer: 'return=representation' },
      body: JSON.stringify({ p_name: `ratelimit-test-${Date.now()}` }),
    })
    expect(createRes.ok, `create_api_key failed: ${createRes.status}`).toBeTruthy()
    const [created] = (await createRes.json()) as { id: string; key: string }[]
    const apiKey = created.key
    const keyId = created.id

    try {
      // Fire until the per-minute limiter trips. The hosted cap is 60/min; loop
      // to 130 so a minute-boundary straddle still guarantees a 429, but break
      // as soon as we see one (normally ~61 requests in).
      let firstStatus = 0
      let got429 = false
      for (let i = 0; i < 130; i++) {
        const res = await fetch(`${url}/functions/v1/api/v1/services`, {
          headers: { apikey: anonKey, 'x-api-key': apiKey },
        })
        if (i === 0) firstStatus = res.status
        if (res.status === 429) {
          const body = await res.json()
          expect(body.error).toBe('rate_limited')
          got429 = true
          break
        }
      }

      // A fresh key starts unthrottled…
      expect(firstStatus, 'first request with a fresh key should be accepted (200)').toBe(200)
      // …and the per-minute cap eventually refuses it.
      expect(got429, 'expected a 429 within 130 requests (per-minute cap is 60)').toBe(true)
    } finally {
      // Always revoke — never leave a live test key on the seeded org.
      await fetch(`${url}/rest/v1/rpc/revoke_api_key`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ p_id: keyId }),
      })
    }
  })
})
