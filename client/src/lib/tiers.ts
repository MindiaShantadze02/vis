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
  /** Photos allowed per resource (room type / table). Mirrors the
   *  enforce_resource_image_limit trigger (migration 057). null = unlimited. */
  imagesPerRoom: number | null
  features: string[]
  colorKey: TierColorKey
}

export const TIERS: TierInfo[] = [
  {
    key: 'free', label: 'უფასო', price: '₾0 / თვე', limit: 30, imagesPerRoom: 3, colorKey: 'grey',
    features: ['30 ჯავშანი/თვე', 'ონლაინ ბუქინგ გვერდი', 'SMS შეტყობინებები'],
  },
  {
    key: 'starter', label: 'სტარტერი', price: '₾15 / თვე', limit: 200, imagesPerRoom: 6, colorKey: 'info',
    features: ['200 ჯავშანი/თვე', 'ყველა უფასო ფუნქცია', 'პრიორიტეტული მხარდაჭერა'],
  },
  {
    key: 'pro', label: 'პრო', price: '₾40 / თვე', limit: 600, imagesPerRoom: 10, colorKey: 'primary',
    features: ['600 ჯავშანი/თვე', 'ყველა სტარტერის ფუნქცია', 'BOG / TBC ონლაინ გადახდა', 'გუნდის მართვა'],
  },
  {
    key: 'business', label: 'ბიზნესი', price: '₾80 / თვე', limit: null, imagesPerRoom: null, colorKey: 'success',
    features: ['ულიმიტო ჯავშნები', 'ყველა პრო ფუნქცია', 'VIP მხარდაჭერა'],
  },
]

/** Photos allowed per resource for a tier (falls back to the hard ceiling). */
export function imagesPerRoomForTier(tier: string | null | undefined, hardMax: number): number {
  const v = tierInfo(tier).imagesPerRoom
  return v == null ? hardMax : Math.min(v, hardMax)
}

/** All tier keys, in display order. */
export const TIER_KEYS: Tier[] = TIERS.map(t => t.key)

/** Look up a tier's info, falling back to the free tier. */
export function tierInfo(key: string | null | undefined): TierInfo {
  return TIERS.find(t => t.key === key) ?? TIERS[0]
}

/** Resolve a tier's accent colour from the theme palette. */
export function tierColor(theme: Theme, key: TierColorKey): string {
  return key === 'grey' ? theme.palette.text.secondary : theme.palette[key].main
}
