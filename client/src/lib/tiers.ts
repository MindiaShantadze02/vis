import type { Theme } from '@mui/material'

/**
 * Subscription tiers — shared between the customer-facing SubscriptionPage and
 * the superadmin org views so labels, prices, limits, and accent colours have
 * one definition. Limits mirror platform_config.tier_limits (null = unlimited).
 */
export type Tier = 'free' | 'starter' | 'pro' | 'business'
export type TierColorKey = 'grey' | 'info' | 'primary' | 'success'

export interface TierInfo {
  key: Tier
  label: string
  price: string
  limit: number | null
  features: string[]
  colorKey: TierColorKey
}

export const TIERS: TierInfo[] = [
  {
    key: 'free', label: 'უფასო', price: '₾0 / თვე', limit: 30, colorKey: 'grey',
    features: ['30 ჯავშანი/თვე', 'ონლაინ ბუქინგ გვერდი', 'SMS შეტყობინებები'],
  },
  {
    key: 'starter', label: 'სტარტერი', price: '₾15 / თვე', limit: 200, colorKey: 'info',
    features: ['200 ჯავშანი/თვე', 'ყველა უფასო ფუნქცია', 'პრიორიტეტული მხარდაჭერა'],
  },
  {
    key: 'pro', label: 'პრო', price: '₾40 / თვე', limit: 600, colorKey: 'primary',
    features: ['600 ჯავშანი/თვე', 'ყველა სტარტერის ფუნქცია', 'BOG / TBC ონლაინ გადახდა', 'გუნდის მართვა', 'ვებსაიტის ვიჯეტი'],
  },
  {
    key: 'business', label: 'ბიზნესი', price: '₾80 / თვე', limit: null, colorKey: 'success',
    features: ['ულიმიტო ჯავშნები', 'ყველა პრო ფუნქცია', 'VIP მხარდაჭერა'],
  },
]

/** All tier keys, in display order (free < starter < pro < business). */
export const TIER_KEYS: Tier[] = TIERS.map(t => t.key)

/**
 * True when `current` is at least as high as `target` in the tier order.
 * Used to gate features by plan (e.g. the embed widget is Pro+). An unknown
 * current tier is treated as the lowest (free), so it never unlocks anything.
 */
export function tierAtLeast(current: string | null | undefined, target: Tier): boolean {
  const ci = TIER_KEYS.indexOf(current as Tier)
  const ti = TIER_KEYS.indexOf(target)
  return ci >= 0 && ci >= ti
}

/** Look up a tier's info, falling back to the free tier. */
export function tierInfo(key: string | null | undefined): TierInfo {
  return TIERS.find(t => t.key === key) ?? TIERS[0]
}

/** Resolve a tier's accent colour from the theme palette. */
export function tierColor(theme: Theme, key: TierColorKey): string {
  return key === 'grey' ? theme.palette.text.secondary : theme.palette[key].main
}
