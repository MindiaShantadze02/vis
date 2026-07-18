import { describe, expect, it } from 'vitest'
import {
  parseEntitlements, usagePercent, overAllowance, isOverAllowance, hasFeature,
  FEATURE_KEYS,
} from './entitlements'

/**
 * BVA + ECP for the entitlements helpers. The overage/allowance boundaries here
 * mirror the DB metering (get_org_entitlements / record_appointment_overage,
 * migration 088): included allowance free, beyond it metered, unlimited = null.
 */

// A representative get_org_entitlements() jsonb payload (solo, active).
const raw = {
  tier: 'solo',
  state: 'active',
  included: 100,
  used: 103,
  overage_price: 0.3,
  overage_count: 3,
  overage_cost: 0.9,
  seat_used: 1,
  seat_limit: null,
  period_start: '2026-07-01T00:00:00+00:00',
  period_end: '2026-08-01T00:00:00+00:00',
  trial_ends_at: '2026-07-31T00:00:00+00:00',
  features: { deposits: true, recurring: true, analytics: true, self_service: true },
}

describe('parseEntitlements', () => {
  it('maps the snake_case RPC payload into the typed shape', () => {
    const ent = parseEntitlements(raw)!
    expect(ent.tier).toBe('solo')
    expect(ent.state).toBe('active')
    expect(ent.included).toBe(100)
    expect(ent.used).toBe(103)
    expect(ent.overagePrice).toBe(0.3)
    expect(ent.overageCount).toBe(3)
    expect(ent.overageCost).toBe(0.9)
    expect(ent.seatLimit).toBeNull()
    expect(ent.features).toEqual({
      deposits: true, recurring: true, analytics: true, self_service: true,
    })
  })

  it('coerces numbers delivered as strings (PostgREST numeric)', () => {
    const ent = parseEntitlements({ ...raw, used: '103', overage_price: '0.30', included: '100' })!
    expect(ent.used).toBe(103)
    expect(ent.overagePrice).toBe(0.3)
    expect(ent.included).toBe(100)
  })

  it('treats a null included/seat_limit as unlimited', () => {
    const ent = parseEntitlements({ ...raw, included: null, seat_limit: null })!
    expect(ent.included).toBeNull()
    expect(ent.seatLimit).toBeNull()
  })

  it('defaults an absent feature flag to false (fail-closed)', () => {
    const ent = parseEntitlements({ ...raw, features: { deposits: true } })!
    expect(ent.features.deposits).toBe(true)
    expect(ent.features.recurring).toBe(false)
    // Every known key is always present in the parsed map.
    expect(Object.keys(ent.features).sort()).toEqual([...FEATURE_KEYS].sort())
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['missing tier', { state: 'active' }],
    ['non-object', 42],
  ])('returns null for a malformed payload (%s)', (_label, input) => {
    expect(parseEntitlements(input)).toBeNull()
  })
})

describe('usagePercent (BVA around the allowance)', () => {
  it.each([
    ['empty', 0, 100, 0],
    ['half', 50, 100, 50],
    ['at the boundary', 100, 100, 100],
    ['over clamps to 100', 130, 100, 100],
    ['unlimited (null) reads 0%', 40, null, 0],
    ['zero allowance reads 0%', 5, 0, 0],
  ])('%s → %d%%', (_label, used, included, expected) => {
    expect(usagePercent(used, included as number | null)).toBe(expected)
  })
})

describe('overAllowance / isOverAllowance (the metering boundary)', () => {
  it.each([
    ['within', 99, 100, 0],
    ['exactly at the allowance is NOT over', 100, 100, 0],
    ['one past is one over', 101, 100, 1],
    ['many past', 130, 100, 30],
    ['unlimited never overflows', 9999, null, 0],
  ])('%s → %d over', (_label, used, included, expected) => {
    expect(overAllowance(used, included as number | null)).toBe(expected)
    expect(isOverAllowance({ used, included: included as number | null })).toBe(expected > 0)
  })
})

describe('hasFeature (fail-closed gate)', () => {
  const ent = parseEntitlements(raw)!
  it('returns true for an enabled feature', () => {
    expect(hasFeature(ent, 'deposits')).toBe(true)
  })
  it('returns false when the map is missing or null', () => {
    expect(hasFeature(null, 'deposits')).toBe(false)
    expect(hasFeature(undefined, 'recurring')).toBe(false)
  })
  it('returns false for a disabled flag', () => {
    const gated = parseEntitlements({ ...raw, features: { deposits: false } })!
    expect(hasFeature(gated, 'deposits')).toBe(false)
  })
})
