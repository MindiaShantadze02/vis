import { useOrg } from '@/contexts/OrgContext'
import { getVerticalConfig, DEFAULT_VERTICAL } from './configs'
import type { Vertical, VerticalConfig } from './types'

/**
 * Resolves the current organisation's vertical config. Use this in any
 * dashboard/booking component that needs vertical-aware terminology, feature
 * gates, or flow selection. When there is no org yet (e.g. public pages before
 * the org loads) it falls back to the default vertical, so callers never have
 * to null-check.
 */
export function useVertical(): VerticalConfig {
  const { org } = useOrg()
  return getVerticalConfig(org?.vertical)
}

/** Convenience accessor for just the vertical key. */
export function useVerticalKey(): Vertical {
  const { org } = useOrg()
  return getVerticalConfig(org?.vertical).key ?? DEFAULT_VERTICAL
}
