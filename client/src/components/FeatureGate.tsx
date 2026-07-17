import type { ReactNode } from 'react'
import { useOrg } from '@/contexts/OrgContext'
import { hasFeature, type FeatureKey } from '@/lib/entitlements'

interface Props {
  feature: FeatureKey
  children: ReactNode
  /** Rendered when the feature is gated for this tier. Defaults to nothing. */
  fallback?: ReactNode
}

/**
 * Conditionally renders `children` only when the current org's tier entitles it
 * to `feature`; otherwise renders `fallback` (an upgrade prompt, say). This is
 * UX only — every feature is ALSO enforced server-side. Fail-closed: while
 * entitlements are still loading (or the lookup failed) it renders nothing
 * rather than flashing gated content or an upgrade prompt.
 *
 * Today every feature is enabled on both tiers (platform_config.tier_features
 * seeds all-true), so this always renders children once entitlements load. It
 * exists so a later phase can gate a feature with a single config flip.
 */
export default function FeatureGate({ feature, children, fallback = null }: Props) {
  const { entitlements, loading } = useOrg()
  if (loading || entitlements === null) return null
  return <>{hasFeature(entitlements, feature) ? children : fallback}</>
}
