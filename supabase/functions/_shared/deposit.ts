// Deno mirror of client/src/lib/deposit.ts — KEEP IN SYNC (line-for-line port;
// the client copy's deposit.parity.test.ts guards them). Pure math, no deps, so
// this is a verbatim copy of the client module minus the doc references.
//
// Deposit computation shared by the booking page (display) and create-payment
// (the charge). Resolution: a service's deposit overrides the org default; a
// NULL service type inherits the org default; 'none' means no deposit.

export type DepositType = 'none' | 'fixed' | 'percent'

export interface DepositConfig {
  type: DepositType | null
  value: number | null
}

/** Service override wins; a null service type inherits the org default. */
export function resolveDeposit(service: DepositConfig, orgDefault: DepositConfig): DepositConfig {
  return service.type != null ? service : orgDefault
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Upfront ₾ to charge, clamped to [0, fullPrice]. */
export function computeDeposit(fullPrice: number, cfg: DepositConfig): number {
  if (!cfg.type || cfg.type === 'none' || cfg.value == null) return 0
  const raw = cfg.type === 'fixed' ? cfg.value : (fullPrice * cfg.value) / 100
  if (!(raw > 0)) return 0
  return Math.min(round2(raw), round2(fullPrice))
}

export type DepositKind = 'none' | 'partial' | 'full'

/** none | partial (balance due in person → deposit_paid) | full (→ paid). */
export function depositKind(fullPrice: number, deposit: number): DepositKind {
  if (deposit <= 0) return 'none'
  return deposit < round2(fullPrice) ? 'partial' : 'full'
}
