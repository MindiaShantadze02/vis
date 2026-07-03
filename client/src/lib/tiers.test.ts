import { describe, expect, it } from 'vitest'
import type { Theme } from '@mui/material'
import { TIERS, TIER_KEYS, tierInfo, tierColor, tierAtLeast } from './tiers'

/**
 * ECP + decision coverage for the tier lookup helpers. Limits mirror
 * platform_config.tier_limits (null = unlimited).
 */
describe('TIERS / TIER_KEYS', () => {
  it('exposes the four tiers in display order', () => {
    expect(TIER_KEYS).toEqual(['free', 'starter', 'pro', 'business'])
  })

  it.each([
    ['free', 30],
    ['starter', 200],
    ['pro', 600],
    ['business', null],
  ])('%s tier has the expected monthly limit', (key, limit) => {
    expect(TIERS.find(t => t.key === key)?.limit).toBe(limit)
  })
})

describe('tierInfo (fallback path)', () => {
  it('returns the matching tier for a known key', () => {
    expect(tierInfo('pro').key).toBe('pro')
  })
  // Decision coverage — the `?? TIERS[0]` fallback branch.
  it.each([['unknown key', 'enterprise'], ['null', null], ['undefined', undefined]])(
    'falls back to the free tier for %s',
    (_label, key) => {
      expect(tierInfo(key as string | null | undefined).key).toBe('free')
    },
  )
})

describe('tierAtLeast (feature gating)', () => {
  // BVA around the pro boundary — the embed widget is gated to pro+.
  it.each([
    ['free', false],
    ['starter', false],
    ['pro', true],
    ['business', true],
  ])('%s vs pro → %s', (current, expected) => {
    expect(tierAtLeast(current, 'pro')).toBe(expected)
  })

  it('an unknown / null / undefined tier never meets a target', () => {
    expect(tierAtLeast('enterprise', 'pro')).toBe(false)
    expect(tierAtLeast(null, 'free')).toBe(false)
    expect(tierAtLeast(undefined, 'free')).toBe(false)
  })

  it('every tier meets the free floor', () => {
    for (const k of TIER_KEYS) expect(tierAtLeast(k, 'free')).toBe(true)
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
