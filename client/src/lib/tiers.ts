import type { Theme } from '@mui/material'

/**
 * Subscription tiers — shared between the customer-facing SubscriptionPage and
 * the superadmin org views so labels, prices, limits, and accent colours have
 * one definition. Limits mirror platform_config.tier_limits / tier_staff_limits.
 *
 * There is no free tier: every new organisation starts on a 30-day
 * Starter-level trial and must pick a paid plan afterwards (see
 * subscriptionState below).
 */
export type Tier = 'starter' | 'pro' | 'business'
export type TierColorKey = 'grey' | 'info' | 'primary' | 'success'

export interface TierInfo {
  key: Tier
  label: string
  price: string
  limit: number
  /** Max bookable staff (null = unlimited). Mirrors tier_staff_limits. */
  staffLimit: number | null
  features: string[]
  colorKey: TierColorKey
  /** The visually highlighted "recommended" plan on pricing surfaces. */
  recommended?: boolean
}

export const TIERS: TierInfo[] = [
  {
    key: 'starter', label: 'სტარტერი', price: '₾29 / თვე', limit: 150, staffLimit: 1, colorKey: 'info',
    features: ['150 ჯავშანი/თვე', 'SMS შეხსენება წინა დღეს', 'ონლაინ ბუქინგ გვერდი', 'ყველა თემა'],
  },
  {
    key: 'pro', label: 'პრო', price: '₾59 / თვე', limit: 400, staffLimit: 3, colorKey: 'primary', recommended: true,
    features: ['400 ჯავშანი/თვე', '3 თანამშრომლამდე', 'ყველა სტარტერის ფუნქცია'],
  },
  {
    key: 'business', label: 'ბიზნესი', price: '₾99 / თვე', limit: 800, staffLimit: null, colorKey: 'success',
    features: ['800 ჯავშანი/თვე', 'შეუზღუდავი თანამშრომლები', 'VIP მხარდაჭერა'],
  },
]

/** All tier keys, in display order (starter < pro < business). */
export const TIER_KEYS: Tier[] = TIERS.map(t => t.key)

/**
 * True when `current` is at least as high as `target` in the tier order.
 * Used to gate features by plan. An unknown current tier is treated as the
 * lowest, so it never unlocks anything above starter.
 */
export function tierAtLeast(current: string | null | undefined, target: Tier): boolean {
  const ci = TIER_KEYS.indexOf(current as Tier)
  const ti = TIER_KEYS.indexOf(target)
  return ci >= 0 && ci >= ti
}

/** Look up a tier's info, falling back to the starter tier. */
export function tierInfo(key: string | null | undefined): TierInfo {
  return TIERS.find(t => t.key === key) ?? TIERS[0]
}

/** Resolve a tier's accent colour from the theme palette. */
export function tierColor(theme: Theme, key: TierColorKey): string {
  return key === 'grey' ? theme.palette.text.secondary : theme.palette[key].main
}

/**
 * Derived subscription state — the client-side mirror of the DB's
 * org_subscription_state():
 *   trial   — no paid subscription yet, trial window still open
 *   active  — paid subscription current
 *   expired — lapsed trial or lapsed paid plan: the org is never disabled,
 *             but new bookings and day-before reminders stop
 */
export type SubscriptionState = 'trial' | 'active' | 'expired'

export function subscriptionState(
  trialEndsAt: string | null | undefined,
  subscriptionExpiresAt: string | null | undefined,
  now: Date = new Date(),
): SubscriptionState {
  if (subscriptionExpiresAt && new Date(subscriptionExpiresAt) > now) return 'active'
  if (!subscriptionExpiresAt && trialEndsAt && new Date(trialEndsAt) > now) return 'trial'
  return 'expired'
}

/** Whole days (ceiling) until the trial ends; 0 when already past. */
export function trialDaysLeft(trialEndsAt: string, now: Date = new Date()): number {
  const ms = new Date(trialEndsAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}
