import { test, expect } from '@playwright/test'
import { readSupabaseEnv, uniquePhone } from './helpers'

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
})
