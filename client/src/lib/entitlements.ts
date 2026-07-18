import type { Tier, SubscriptionState } from '@/lib/tiers'

/**
 * Entitlements — the client mirror of the DB's get_org_entitlements(org) RPC
 * (migration 088). One cacheable read that drives the usage widget and the
 * (currently permissive) feature gates.
 *
 * Tiering model since 2026-07-17: a tier's `included` allowance is free; every
 * booking beyond it is ALLOWED and metered as overage (billing reconciles
 * against overage_events later — nothing is charged yet). Only an `expired`
 * org (lapsed trial / lapsed plan) is actually blocked from new bookings.
 */

/** Feature keys in platform_config.tier_features. All true on both tiers today. */
export type FeatureKey =
  | 'deposits'
  | 'recurring'
  | 'analytics'
  | 'self_service'

export const FEATURE_KEYS: FeatureKey[] = [
  'deposits', 'recurring', 'analytics', 'self_service',
]

export interface Entitlements {
  tier: Tier
  state: SubscriptionState
  /** Included allowance for the period; null = unlimited. */
  included: number | null
  /** Bookings used in the current period (excl. cancelled/rejected). */
  used: number
  /** ₾ per over-allowance booking; null when unknown. */
  overagePrice: number | null
  /** Over-allowance bookings recorded this period. */
  overageCount: number
  /** overageCount × overagePrice, in ₾. */
  overageCost: number
  /** Bookable professionals in use. */
  seatUsed: number
  /** Max bookable professionals; null = unlimited (both tiers today). */
  seatLimit: number | null
  periodStart: string
  periodEnd: string
  trialEndsAt: string
  /** Per-feature entitlement map for the org's tier. */
  features: Record<FeatureKey, boolean>
}

/**
 * Parse the get_org_entitlements jsonb (snake_case) into the typed shape.
 * PostgREST/jsonb hands numbers back as JSON numbers, but coerce defensively.
 * Returns null for a missing/malformed payload so callers can no-op cleanly.
 */
export function parseEntitlements(raw: unknown): Entitlements | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!r.tier) return null

  const num = (v: unknown): number => (v == null ? 0 : Number(v))
  const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v))

  const rawFeatures = (r.features ?? {}) as Record<string, unknown>
  const features = FEATURE_KEYS.reduce((acc, k) => {
    // Unknown/absent key defaults to false (fail-closed for gating), but the
    // DB seeds every key true on both tiers, so today everything unlocks.
    acc[k] = rawFeatures[k] === true
    return acc
  }, {} as Record<FeatureKey, boolean>)

  return {
    tier: r.tier as Tier,
    state: r.state as SubscriptionState,
    included: numOrNull(r.included),
    used: num(r.used),
    overagePrice: numOrNull(r.overage_price),
    overageCount: num(r.overage_count),
    overageCost: num(r.overage_cost),
    seatUsed: num(r.seat_used),
    seatLimit: numOrNull(r.seat_limit),
    periodStart: String(r.period_start ?? ''),
    periodEnd: String(r.period_end ?? ''),
    trialEndsAt: String(r.trial_ends_at ?? ''),
    features,
  }
}

/** Fill of the usage bar, 0–100. Unlimited (null included) reads as 0%. */
export function usagePercent(used: number, included: number | null): number {
  if (!included || included <= 0) return 0
  return Math.min((used / included) * 100, 100)
}

/** Bookings used beyond the included allowance (0 when within / unlimited). */
export function overAllowance(used: number, included: number | null): number {
  if (included == null) return 0
  return Math.max(0, used - included)
}

/** True once usage has passed the included allowance. */
export function isOverAllowance(ent: Pick<Entitlements, 'used' | 'included'>): boolean {
  return overAllowance(ent.used, ent.included) > 0
}

/**
 * Whether a tier feature is enabled. Fail-closed: an unknown/absent flag is
 * treated as off. Nothing is gated today (all flags seed true), but later
 * phases call this so a config flip is all it takes to gate.
 */
export function hasFeature(
  ent: Pick<Entitlements, 'features'> | null | undefined,
  key: FeatureKey,
): boolean {
  return !!ent?.features?.[key]
}
