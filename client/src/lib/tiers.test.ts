import { describe, expect, it } from 'vitest'
import type { Theme } from '@mui/material'
import {
  TIERS, TIER_KEYS, tierInfo, tierColor, tierAtLeast,
  subscriptionState, trialDaysLeft,
} from './tiers'

/**
 * ECP + decision coverage for the tier lookup helpers. Limits mirror
 * platform_config.tier_limits / tier_staff_limits.
 */
describe('TIERS / TIER_KEYS', () => {
  it('exposes the two paid tiers in display order (no free tier)', () => {
    expect(TIER_KEYS).toEqual(['solo', 'team'])
  })

  it.each([
    ['solo', 100, 1],
    ['team', 300, null],
  ])('%s tier has the expected monthly and staff limits', (key, limit, staffLimit) => {
    const t = TIERS.find(t => t.key === key)
    expect(t?.limit).toBe(limit)
    expect(t?.staffLimit).toBe(staffLimit)
  })

  it('team is the single recommended plan', () => {
    expect(TIERS.filter(t => t.recommended).map(t => t.key)).toEqual(['team'])
  })
})

describe('tierInfo (fallback path)', () => {
  it('returns the matching tier for a known key', () => {
    expect(tierInfo('team').key).toBe('team')
  })
  // Decision coverage — the `?? TIERS[0]` fallback branch. 'starter' is a
  // realistic stale value (pre-083 orgs) and must resolve to solo.
  it.each([['removed starter tier', 'starter'], ['removed business tier', 'business'], ['unknown key', 'enterprise'], ['null', null], ['undefined', undefined]])(
    'falls back to the solo tier for %s',
    (_label, key) => {
      expect(tierInfo(key as string | null | undefined).key).toBe('solo')
    },
  )
})

describe('tierAtLeast (feature gating)', () => {
  // BVA around the team boundary.
  it.each([
    ['solo', false],
    ['team', true],
  ])('%s vs team → %s', (current, expected) => {
    expect(tierAtLeast(current, 'team')).toBe(expected)
  })

  it('an unknown / null / undefined tier never meets a target', () => {
    expect(tierAtLeast('free', 'solo')).toBe(false)
    expect(tierAtLeast('business', 'team')).toBe(false)
    expect(tierAtLeast(null, 'solo')).toBe(false)
    expect(tierAtLeast(undefined, 'solo')).toBe(false)
  })

  it('every tier meets the solo floor', () => {
    for (const k of TIER_KEYS) expect(tierAtLeast(k, 'solo')).toBe(true)
  })
})

describe('tierColor (both branches)', () => {
  const theme = {
    palette: {
      text: { secondary: '#999' },
      info: { main: '#00f' },
      primary: { main: '#0f0' },
      success: { main: '#0ff' },
    },
  } as unknown as Theme

  it('resolves "grey" to the secondary text colour', () => {
    expect(tierColor(theme, 'grey')).toBe('#999')
  })
  it('resolves a palette key to its main colour', () => {
    expect(tierColor(theme, 'primary')).toBe('#0f0')
  })
})

describe('subscriptionState (mirror of DB org_subscription_state)', () => {
  const now = new Date('2026-07-09T12:00:00Z')
  const past = '2026-07-08T12:00:00Z'
  const future = '2026-07-10T12:00:00Z'

  // Decision table over the two timestamps.
  it.each([
    ['trial window open, never paid', future, null, 'trial'],
    ['trial lapsed, never paid', past, null, 'expired'],
    ['paid and current', past, future, 'active'],
    ['paid and current during trial window', future, future, 'active'],
    ['paid but lapsed', past, past, 'expired'],
    ['paid but lapsed, trial window still open', future, past, 'expired'],
    ['no timestamps at all', null, null, 'expired'],
  ])('%s → %s', (_label, trialEnd, subExpiry, expected) => {
    expect(subscriptionState(trialEnd, subExpiry, now)).toBe(expected)
  })

  // BVA: the boundary instant itself is NOT in the future → expired/expired.
  it('a trial ending exactly now is expired', () => {
    expect(subscriptionState(now.toISOString(), null, now)).toBe('expired')
  })
  it('a subscription expiring exactly now is expired', () => {
    expect(subscriptionState(null, now.toISOString(), now)).toBe('expired')
  })
})

describe('trialDaysLeft', () => {
  const now = new Date('2026-07-09T12:00:00Z')

  it.each([
    ['30 days out', '2026-08-08T12:00:00Z', 30],
    ['a partial day rounds up', '2026-07-10T00:00:00Z', 1],
    ['already past clamps to 0', '2026-07-08T12:00:00Z', 0],
    ['exactly now is 0', '2026-07-09T12:00:00Z', 0],
  ])('%s → %d', (_label, end, expected) => {
    expect(trialDaysLeft(end, now)).toBe(expected)
  })
})
