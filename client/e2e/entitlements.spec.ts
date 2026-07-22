import { test, expect } from '@playwright/test'
import { signInSeed, restApi, SEED } from './helpers'

/**
 * Entitlements substrate (Phase 1, migration 088) — the keystone every later
 * phase reads. This exercises the two server RPCs directly (owner context via
 * PostgREST); the UI side (usage meter, no "blocked" copy, tier cards) is in
 * subscription.spec.ts, and the allowance/overage/period MATH is unit-tested in
 * src/lib/entitlements.test.ts.
 *
 * Technique mapping:
 *   - Equivalence partitioning over the subscription-state classes. Only `active`
 *     is reachable on the pinned seed org (the trial/expired classes are guarded
 *     out of the UI by design and covered in tiers.test.ts), so we assert the
 *     one reachable partition thoroughly and document the rest.
 *   - Decision-table check of the two confirmed product decisions that live in
 *     config, not code: NO feature gating (every feature true on the tier) and
 *     UNLIMITED seats on both tiers (seat_limit is null).
 */
test.describe('Entitlements — get_org_entitlements contract', () => {
  test('returns the full active-org entitlement shape (unlimited seats, no gating, metered overage)', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const e = (await restApi(ctx, 'rpc/get_org_entitlements', {
      method: 'POST',
      body: JSON.stringify({ p_org_id: org[0].id }),
    })) as Record<string, unknown>

    // ── State + allowance partition: pinned active solo org, under allowance ──
    expect(e.tier).toBe('solo')
    expect(e.state).toBe('active')
    expect(Number(e.included)).toBe(80) // solo included allowance
    expect(Number(e.used)).toBeGreaterThanOrEqual(0)
    expect(Number(e.used)).toBeLessThan(Number(e.included)) // seed stays under cap

    // ── Overage fields present + coherent. Under allowance → no accrued overage. ──
    // (Crossing the allowance boundary is a BEFORE-INSERT trigger behavior verified
    // at the DB layer; reproducing it live would mean 80+ permanent seed rows.)
    expect(e).toHaveProperty('overage_price')
    expect(Number(e.overage_count)).toBe(0)
    expect(Number(e.overage_cost)).toBe(0)

    // ── Credit fields (hard-cap top-up, 2026-07-22). credit_balance is spendable
    // credit; credit_used counts over-allowance bookings this period (0 under cap).
    // The seed org carries a large credit buffer so the hard cap never disrupts
    // the booking specs, so assert it's a real non-negative number, not a fixed one.
    expect(e).toHaveProperty('credit_balance')
    expect(Number(e.credit_balance)).toBeGreaterThanOrEqual(0)
    expect(Number(e.credit_used)).toBe(0)

    // ── Decision: UNLIMITED seats on both tiers → seat_limit is null. ──
    // seat_used counts BOOKABLE members; the seed owner isn't flagged bookable
    // and has no staff, so 0 is valid — the point is it's a real count with no cap.
    expect(e.seat_limit).toBeNull()
    expect(Number(e.seat_used)).toBeGreaterThanOrEqual(0)

    // ── Decision: NO feature gating → every feature resolves true on this tier. ──
    const features = e.features as Record<string, boolean>
    expect(features).toMatchObject({
      deposits: true, recurring: true, analytics: true, self_service: true,
    })
    expect(Object.values(features).every(Boolean)).toBeTruthy()

    // ── Billing period is a rolling anniversary window (start < end). ──
    expect(new Date(String(e.period_start)).getTime())
      .toBeLessThan(new Date(String(e.period_end)).getTime())
  })

  test('org_can_accept_appointment is true for an active org under its allowance', async () => {
    // Hard-cap model (2026-07-22): an active org accepts while under its included
    // allowance; over the allowance it accepts only while it has credit, else
    // raises limit_reached. Expired = always blocked; trial = soft (always).
    // The seed org is active and under cap (and holds a credit buffer) → accepts.
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const canAccept = (await restApi(ctx, 'rpc/org_can_accept_appointment', {
      method: 'POST',
      body: JSON.stringify({ p_org_id: org[0].id }),
    })) as boolean
    expect(canAccept).toBe(true)
  })
})
