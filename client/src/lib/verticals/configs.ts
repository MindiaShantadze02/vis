import type { Vertical, VerticalConfig } from './types'

/**
 * The single source of truth for what each vertical can do. Components and the
 * booking/onboarding flows read from here via `getVerticalConfig()` / the
 * `useVertical()` hook rather than branching on the raw vertical string.
 *
 * NOTE: `appointments` is fully described because it is the live product.
 * `restaurant` and `hotel` declare their capability shape now (so the type
 * system and feature gates are ready), but their screens/flows are wired in
 * their own rollout phases. Until then an org can only ever be 'appointments'
 * in practice (onboarding does not yet offer the others).
 */
export const VERTICAL_CONFIGS: Record<Vertical, VerticalConfig> = {
  appointments: {
    key: 'appointments',
    i18nNamespace: 'translation',
    features: {
      hasStaff: true,
      hasPartySize: false,
      hasDateRange: false,
      hasNightlyPricing: false,
      hasDeposits: false,
    },
    settingsNav: ['profile', 'services', 'hours', 'team', 'payment', 'subscription'],
    showCalendar: true,
  },
  restaurant: {
    key: 'restaurant',
    i18nNamespace: 'restaurant',
    features: {
      hasStaff: false,
      hasPartySize: true,
      hasDateRange: false,
      hasNightlyPricing: false,
      hasDeposits: true,
    },
    settingsNav: ['profile', 'tables', 'hours', 'payment', 'subscription'],
    showCalendar: false,
  },
  hotel: {
    key: 'hotel',
    i18nNamespace: 'hotel',
    features: {
      hasStaff: false,
      hasPartySize: false,
      hasDateRange: true,
      hasNightlyPricing: true,
      hasDeposits: true,
    },
    // No 'hours': hotels have no weekly working hours (availability is date-range
    // based). Check-in/out times live in the Profile tab.
    settingsNav: ['profile', 'rooms', 'payment', 'subscription'],
    showCalendar: false,
  },
}

/** The default/fallback vertical — matches the DB column default. */
export const DEFAULT_VERTICAL: Vertical = 'appointments'

/**
 * Resolve a vertical config from a raw value (e.g. `org.vertical`). Anything
 * unknown or missing falls back to the appointments config, so older orgs or
 * a DB without the `vertical` column behave exactly as today.
 */
export function getVerticalConfig(vertical: string | null | undefined): VerticalConfig {
  if (vertical && vertical in VERTICAL_CONFIGS) {
    return VERTICAL_CONFIGS[vertical as Vertical]
  }
  return VERTICAL_CONFIGS[DEFAULT_VERTICAL]
}
