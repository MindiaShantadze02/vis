/**
 * Billing — the client mirror of the DB's get_org_billing_status(org) RPC
 * (post-paid usage billing). One cacheable read that drives the running-bill
 * meter and the billing settings page.
 *
 * Model: signup is free; every billable appointment in the current period meters
 * at a flat per-appointment price; the business is charged once a month for what
 * it used, against a card on file. `billingStatus` is active / past_due /
 * suspended — suspended blocks new bookings (data/page stay alive).
 */

export type BillingState = 'active' | 'past_due' | 'suspended'

export interface CardOnFile {
  last4: string | null
  brand: string | null
  expiresAt: string | null
}

export interface BillingStatus {
  status: BillingState
  periodStart: string
  periodEnd: string
  /** Billable appointments so far this period (occurrence-date, billable states). */
  appointmentCount: number
  /** ₾ per billable appointment. */
  appointmentPrice: number
  /** appointmentCount × appointmentPrice, in ₾. */
  runningAmount: number
  /** Below-floor balance carried from the previous period (0 when none). */
  rolledForward: number
  /** Saved card metadata, or null when none on file. */
  card: CardOnFile | null
}

/**
 * Parse the get_org_billing_status jsonb (snake_case) into the typed shape.
 * PostgREST/jsonb returns numerics as JSON numbers, but coerce defensively.
 * Returns null for a missing/malformed payload so callers can no-op cleanly.
 */
export function parseBillingStatus(raw: unknown): BillingStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!r.billing_status) return null

  const num = (v: unknown): number => (v == null ? 0 : Number(v))
  const rawCard = r.card as Record<string, unknown> | null | undefined
  const card: CardOnFile | null = rawCard
    ? {
        last4: rawCard.last4 != null ? String(rawCard.last4) : null,
        brand: rawCard.brand != null ? String(rawCard.brand) : null,
        expiresAt: rawCard.expires_at != null ? String(rawCard.expires_at) : null,
      }
    : null

  return {
    status: r.billing_status as BillingState,
    periodStart: String(r.period_start ?? ''),
    periodEnd: String(r.period_end ?? ''),
    appointmentCount: num(r.appointment_count),
    appointmentPrice: num(r.appointment_price),
    runningAmount: num(r.running_amount),
    rolledForward: num(r.rolled_forward),
    card,
  }
}

/** The amount an owner would be billed today: this period + any rolled-forward. */
export function currentBillTotal(b: Pick<BillingStatus, 'runningAmount' | 'rolledForward'>): number {
  return Math.round((b.runningAmount + b.rolledForward) * 100) / 100
}

export type CardExpiryState = 'valid' | 'expiring_soon' | 'expired'

/**
 * Card expiry state. `expiresAt` is stored as the FIRST of the expiry month; a
 * card is valid through the END of that month. 'expiring_soon' is the ≤30-day
 * window (T3.3 warns at 30 and 7 days; both fall in this state). A null/blank
 * expiry (no card, or unknown) reads as 'valid' so callers don't false-warn.
 */
export function cardExpiryState(expiresAt: string | null, now: Date = new Date()): CardExpiryState {
  if (!expiresAt) return 'valid'
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) return 'valid'
  // Last moment of the expiry month.
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)
  const ms = end - now.getTime()
  if (ms < 0) return 'expired'
  if (ms <= 30 * 86_400_000) return 'expiring_soon'
  return 'valid'
}
