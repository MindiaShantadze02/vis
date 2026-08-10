// Deposit resolution + amount computation. Mirror of
// supabase/functions/_shared/deposit.ts — keep the two in sync. The booking form
// previews the deposit with these helpers; create-payment computes the actual
// charge with the identical logic; the normalize_guest_appointment SQL trigger
// mirrors the same rules server-side.

export type DepositType = 'none' | 'fixed' | 'percent'

export interface DepositConfig {
  deposit_type: DepositType | null
  deposit_value: number | null
}

/**
 * Resolve the effective deposit config for a service: a service override wins,
 * and a NULL service deposit_type inherits the org default.
 */
export function resolveDeposit(
  service: DepositConfig,
  org: DepositConfig,
): { type: DepositType; value: number } {
  const useService = service.deposit_type != null
  const type = ((useService ? service.deposit_type : org.deposit_type) ?? 'none') as DepositType
  const value = Number((useService ? service.deposit_value : org.deposit_value) ?? 0)
  return { type, value }
}

/** Deposit amount owed for a booking, clamped to [0, price] and rounded to 2dp. */
export function computeDeposit(price: number, type: DepositType, value: number): number {
  const p = Math.max(0, Number(price) || 0)
  if (type === 'fixed') return clamp2(Number(value) || 0, p)
  if (type === 'percent') return clamp2((p * (Number(value) || 0)) / 100, p)
  return 0
}

/** Convenience: resolve + compute the deposit for a service/org/price. */
export function depositFor(service: DepositConfig, org: DepositConfig, price: number): number {
  const { type, value } = resolveDeposit(service, org)
  return computeDeposit(price, type, value)
}

function clamp2(amount: number, price: number): number {
  const clamped = Math.min(Math.max(0, amount), price)
  return Math.round(clamped * 100) / 100
}
