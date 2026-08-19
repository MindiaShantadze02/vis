import { test, expect } from '@playwright/test'
import { signInSeed, restApi, serviceApi, serviceRoleKey, readSupabaseEnv, SEED } from './helpers'

/**
 * Collection integrity (migration 20260824120000). Covers the four ways an org
 * could use Vis without paying that exploratory testing found on 2026-08-19:
 *
 *   1. remove the card and never be dunned  (was a silent REGRESSION — a later
 *      migration re-declared charge_billing_period from a pre-fix copy)
 *   2. sign up with the billing clock set to 2099 so no period ever closes
 *   3. mass-cancel already-delivered appointments before the nightly close
 *   4. the two-step version of (3): move an elapsed appointment into the future
 *      first, then cancel it while it is "future"
 *
 * ...plus the cross-tenant guard on pay_org_outstanding. That last one exists
 * because the FIRST attempt at these fixes shipped an owner check that failed
 * OPEN (get_user_org_role() returns NULL for a foreign org, so `NOT (NULL OR
 * false)` is NULL and the RAISE never fired), which briefly let any authenticated
 * user settle another org's invoices. billing.spec's cross-org test caught it on
 * remove_org_card; nothing covered the RPC where it actually did damage.
 *
 * Appointments here are seeded with the service role because the booking flow
 * correctly refuses to create anything in the past — which is exactly the state
 * these guards are about.
 */

const PAST = () => new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
const FUTURE = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

/**
 * Seed one appointment on the seed org. Three things the schema forces here,
 * all learned by hitting them:
 *   - `customers` has no org_id column;
 *   - enforce_booking_verification demands a verified, unconsumed OTP for any
 *     insert that is not made by a member of the org, so one is seeded first;
 *   - the normalize trigger pins `status` on the guest path, so the desired
 *     status is applied as a follow-up UPDATE rather than in the insert.
 */
async function seedAppointment(status: string, scheduledAt: string) {
  const phone = `5${String(Date.now()).slice(-8)}`
  const [org] = (await serviceApi(`organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
  const [svc] = (await serviceApi(
    `services?org_id=eq.${org.id}&is_active=eq.true&select=id&limit=1`,
  )) as { id: string }[]

  await serviceApi('booking_verifications', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      code_hash: 'e2e-fixture',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      verified_at: new Date().toISOString(),
    }),
  })
  const [cust] = (await serviceApi('customers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ first_name: 'Billing', last_name: 'Fixture', phone_number: phone }),
  })) as { id: string }[]
  const [appt] = (await serviceApi('appointments', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      org_id: org.id,
      service_id: svc.id,
      customer_id: cust.id,
      scheduled_at: scheduledAt,
      duration_minutes: 30,
    }),
  })) as { id: string }[]

  await serviceApi(`appointments?id=eq.${appt.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return { id: appt.id, customerId: cust.id, phone }
}

type Fixture = Awaited<ReturnType<typeof seedAppointment>>

async function dropAppointment(f: Fixture) {
  await serviceApi(`appointments?id=eq.${f.id}`, { method: 'DELETE' })
  await serviceApi(`customers?id=eq.${f.customerId}`, { method: 'DELETE' })
  await serviceApi(`booking_verifications?phone=eq.${f.phone}`, { method: 'DELETE' })
}

test.describe('Billing collection integrity', () => {
  test('cancelling an already-delivered appointment still bills it', async () => {
    test.skip(!serviceRoleKey(), NEEDS_SR)
    const f = await seedAppointment('completed', PAST())
    try {
      const ctx = await signInSeed()
      // The evasion: the owner marks a delivered appointment cancelled before
      // the nightly close recounts. One UPDATE took a real month ₾133 → ₾0.
      await restApi(ctx, `appointments?id=eq.${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const [row] = (await serviceApi(
        `appointments?id=eq.${f.id}&select=status,billable_locked_at,billable_period_at`,
      )) as { status: string; billable_locked_at: string | null; billable_period_at: string | null }[]

      expect(row.status).toBe('cancelled')          // the cancel itself is allowed
      expect(row.billable_locked_at).not.toBeNull() // ...but it stays billable
      expect(row.billable_period_at).not.toBeNull() // ...in its original month
    } finally {
      await dropAppointment(f)
    }
  })

  test('cancelling a FUTURE booking is still free', async () => {
    test.skip(!serviceRoleKey(), NEEDS_SR)
    const f = await seedAppointment('approved', FUTURE())
    try {
      const ctx = await signInSeed()
      await restApi(ctx, `appointments?id=eq.${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const [row] = (await serviceApi(
        `appointments?id=eq.${f.id}&select=billable_locked_at`,
      )) as { billable_locked_at: string | null }[]

      // The service was never delivered, so this must NOT be charged — the guard
      // has to bite on elapsed appointments only.
      expect(row.billable_locked_at).toBeNull()
    } finally {
      await dropAppointment(f)
    }
  })

  test('moving an elapsed appointment into the future pins its billing month', async () => {
    test.skip(!serviceRoleKey(), NEEDS_SR)
    const original = PAST()
    const f = await seedAppointment('completed', original)
    try {
      const ctx = await signInSeed()
      // Two-step evasion: make it "future", then cancel it as a future booking.
      await restApi(ctx, `appointments?id=eq.${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduled_at: FUTURE() }),
      })
      await restApi(ctx, `appointments?id=eq.${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const [row] = (await serviceApi(
        `appointments?id=eq.${f.id}&select=billable_locked_at,billable_period_at`,
      )) as { billable_locked_at: string | null; billable_period_at: string | null }[]

      expect(row.billable_locked_at).not.toBeNull()
      // Pinned to when it actually happened, not where it was moved to.
      expect(row.billable_period_at!.slice(0, 10)).toBe(original.slice(0, 10))
    } finally {
      await dropAppointment(f)
    }
  })

  test('an owner cannot choose their own billing clock at sign-up', async () => {
    test.skip(!serviceRoleKey(), NEEDS_SR)
    const ctx = await signInSeed()
    const slug = `e2e-anchor-${Date.now().toString().slice(-8)}`
    let orgId: string | null = null
    try {
      // organisations_insert is WITH CHECK (auth.uid() IS NOT NULL) — no column
      // list — so the BEFORE INSERT trigger is the only thing stopping a 2099
      // anchor, which would mean no billing period ever closes.
      const [created] = (await restApi(ctx, 'organisations', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name: 'E2E anchor probe', slug, usage_anchor: '2099-01-01' }),
      })) as { id: string; usage_anchor: string }[]
      orgId = created.id

      expect(new Date(created.usage_anchor).getFullYear()).toBe(new Date().getFullYear())
    } finally {
      if (orgId) await serviceApi(`organisations?id=eq.${orgId}`, { method: 'DELETE' })
    }
  })

  test('putting a card back on file collects the outstanding bill', async () => {
    test.skip(!serviceRoleKey(), NEEDS_SR)
    const slug = `e2e-collect-${Date.now().toString().slice(-8)}`
    let orgId: string | null = null
    try {
      // A business two months old, with a bill that has come due and no card:
      // exactly the state "I removed my card at the end of the month" lands in.
      const anchor = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      const [org] = (await serviceApi('organisations', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name: 'E2E collect probe', slug, usage_anchor: anchor }),
      })) as { id: string }[]
      orgId = org.id

      await serviceApi('billing_periods', {
        method: 'POST',
        body: JSON.stringify({
          org_id: orgId,
          period_start: anchor.slice(0, 10),
          period_end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          appointment_count: 40,
          amount_due: 40,
          status: 'pending',
          notified_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      })

      const { url } = readSupabaseEnv()
      const key = serviceRoleKey()!
      const rpc = async (fn: string, body: unknown) => {
        const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) throw new Error(`${fn} → ${r.status} ${await r.text()}`)
        return r.text()
      }

      // No card + a due charge is uncollectable → dunning, NOT a silent skip.
      // This is the assertion that would have caught the regression.
      await rpc('charge_billing_period', {
        p_id: ((await serviceApi(`billing_periods?org_id=eq.${orgId}&select=id`)) as { id: string }[])[0].id,
      })
      let [after] = (await serviceApi(`organisations?id=eq.${orgId}&select=billing_status`)) as
        { billing_status: string }[]
      expect(after.billing_status).toBe('past_due')

      // Card back on file → the bill is collected and the org recovers.
      await rpc('store_org_card', {
        p_org_id: orgId, p_provider: 'mock', p_token: 'tok_e2e',
        p_last4: '4242', p_brand: 'visa', p_expires_at: '2030-01-01',
      })
      const [period] = (await serviceApi(`billing_periods?org_id=eq.${orgId}&select=status`)) as
        { status: string }[]
      ;[after] = (await serviceApi(`organisations?id=eq.${orgId}&select=billing_status`)) as
        { billing_status: string }[]

      expect(period.status).toBe('charged')
      expect(after.billing_status).toBe('active')
    } finally {
      if (orgId) await serviceApi(`organisations?id=eq.${orgId}`, { method: 'DELETE' })
    }
  })

  test('one org cannot settle another org\'s invoices', async () => {
    // The twin of billing.spec's remove_org_card test. That RPC is harmless when
    // the guard leaks (its UPDATE is org-scoped); THIS one settles whatever it is
    // pointed at, so it is the one that needed covering.
    const ctx = await signInSeed()
    const res = await fetch(`${ctx.url}/rest/v1/rpc/pay_org_outstanding`, {
      method: 'POST',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_org_id: '00000000-0000-0000-0000-000000000001' }),
    })
    expect(res.ok).toBeFalsy()
    expect(await res.text()).toContain('not_authorized')
  })
})
