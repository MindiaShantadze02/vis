import { useOrg } from '@/contexts/OrgContext'
import { hasFeature, type Entitlements, type FeatureKey } from '@/lib/entitlements'

/**
 * The current org's full entitlements (allowance / overage / seats / features),
 * or null until loaded. Usage widgets read the allowance fields; feature gates
 * should prefer useEntitlement below.
 */
export function useEntitlements(): Entitlements | null {
  return useOrg().entitlements
}

/**
 * Whether the current org's tier enables `feature`. Fail-closed: false while
 * entitlements are still loading or if the lookup failed, so a gated feature is
 * never shown on incomplete data. Nothing is gated today (all flags seed true
 * on both tiers), so this returns true for every feature once loaded — later
 * phases flip a platform_config.tier_features key to gate.
 */
export function useEntitlement(feature: FeatureKey): boolean {
  return hasFeature(useOrg().entitlements, feature)
}
