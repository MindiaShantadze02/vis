/**
 * Deposit computation — the single source of truth for "how much is charged
 * upfront to confirm a booking", shared by the booking page (display) and the
 * create-payment edge function (the charge). KEEP IN SYNC with the Deno mirror
 * at supabase/functions/_shared/deposit.ts (guarded by deposit.parity.test.ts).
 *
 * Resolution: a service's deposit overrides the org default; a NULL service
 * type inherits the org default; 'none' means explicitly no deposit.
 */

export type DepositType = 'none' | 'fixed' | 'percent'

export interface DepositConfig {
  /** null on a service = inherit the org default. */
  type: DepositType | null
  /** ₾ for 'fixed', 0–100 for 'percent'. */
  value: number | null
}

/** Service override wins; a null service type inherits the org default. */
export function resolveDeposit(service: DepositConfig, orgDefault: DepositConfig): DepositConfig {
  return service.type != null ? service : orgDefault
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Upfront amount to charge for a service priced `fullPrice`, in ₾. Clamped to
 * [0, fullPrice] — a fixed deposit above the price collapses to full payment,
 * and a non-positive/absent config means no deposit (0).
 */
export function computeDeposit(fullPrice: number, cfg: DepositConfig): number {
  if (!cfg.type || cfg.type === 'none' || cfg.value == null) return 0
  const raw = cfg.type === 'fixed' ? cfg.value : (fullPrice * cfg.value) / 100
  if (!(raw > 0)) return 0
  return Math.min(round2(raw), round2(fullPrice))
}

export type DepositKind = 'none' | 'partial' | 'full'

/**
 * Whether the computed deposit is none, a partial deposit (balance due in
 * person → payment_status 'deposit_paid') or effectively full prepayment
 * (→ 'paid'). Drives both the booking copy and the settled payment_status.
 */
export function depositKind(fullPrice: number, deposit: number): DepositKind {
  if (deposit <= 0) return 'none'
  return deposit < round2(fullPrice) ? 'partial' : 'full'
}
