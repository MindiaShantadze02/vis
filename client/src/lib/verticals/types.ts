/**
 * Multi-vertical configuration types.
 *
 * A "vertical" is the kind of booking business an organisation runs. Each org
 * is locked to one vertical (see migration 044_org_vertical.sql). The config
 * layer below lets the UI render the right terminology, screens, and booking
 * flow per vertical WITHOUT scattering `if (vertical === ...)` checks through
 * the components — everything derives from the org's `vertical`.
 */

export type Vertical = 'appointments' | 'restaurant' | 'hotel'

export const VERTICALS: readonly Vertical[] = ['appointments', 'restaurant', 'hotel'] as const

/**
 * Capability flags that drive conditional UI. Keep these behavioural (what the
 * vertical can do), not cosmetic — copy/labels belong in `i18nNamespace`.
 */
export interface VerticalFeatures {
  /** Bookings are assigned to a person (staff/specialist). */
  hasStaff: boolean
  /** A booking has a party/group size (restaurant covers). */
  hasPartySize: boolean
  /** A booking spans a date range (hotel check-in → check-out) rather than a single slot. */
  hasDateRange: boolean
  /** Price is computed per night rather than a flat per-booking amount. */
  hasNightlyPricing: boolean
  /** Supports taking a deposit / prepayment to hold the booking. */
  hasDeposits: boolean
}

/**
 * Stable identifiers for the dashboard settings sections. Each vertical lists
 * the ones it shows, in order — this is what keeps a restaurant from ever
 * seeing "Services"/"Team" and an appointments business from seeing "Tables".
 */
export type SettingsNavId =
  | 'profile'
  | 'services'
  | 'tables'
  | 'rooms'
  | 'hours'
  | 'team'
  | 'payment'
  | 'subscription'

export interface VerticalConfig {
  key: Vertical
  /** i18next namespace holding this vertical's terminology. */
  i18nNamespace: string
  features: VerticalFeatures
  /** Dashboard settings sections shown for this vertical, in display order. */
  settingsNav: SettingsNavId[]
}
