/**
 * Session packages (abonements) — the client mirror of the DB rules in
 * migration 20260723120000_session_packages. Teachers sell "8 lessons for ₾200"
 * and redeem sessions against appointments.
 *
 * These are PURE functions mirroring record_package_consumption's guard order
 * (paid → not expired → service match → sessions remaining) and the series
 * pre-check in create_recurrence_series (remaining ≥ occurrence_count). The DB
 * is the source of truth and enforces all of this; the client uses these only
 * to pre-validate and to render remaining-session counters, never as the gate.
 */

/** A sold package row (customer_packages) joined with its catalogue service. */
export interface CustomerPackage {
  id: string
  /** Sessions the package grants (snapshot at sale time). */
  sessionsTotal: number
  /** Sessions already consumed by appointments. */
  sessionsUsed: number
  /** ISO expiry, or null for no expiry. */
  expiresAt: string | null
  paymentStatus: 'pending' | 'paid' | 'failed'
  /** packages.service_id — null means redeemable against any service. */
  packageServiceId: string | null
}

/** Why a package can't be redeemed — mirrors the trigger's RAISE messages. */
export type RedeemBlock =
  | 'not_paid'
  | 'expired'
  | 'service_mismatch'
  | 'exhausted'

/** Sessions still available. Never negative. */
export function remainingSessions(total: number, used: number): number {
  return Math.max(0, total - used)
}

/** Remaining on a package row. */
export function packageRemaining(pkg: Pick<CustomerPackage, 'sessionsTotal' | 'sessionsUsed'>): number {
  return remainingSessions(pkg.sessionsTotal, pkg.sessionsUsed)
}

/**
 * Whether the package has expired. A null expiry never expires. The boundary is
 * inclusive of "now" (expiresAt <= now → expired), matching the DB's
 * `expires_at <= now()` guard exactly.
 */
export function isPackageExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false
  const exp = new Date(expiresAt).getTime()
  if (Number.isNaN(exp)) return false
  return exp <= now.getTime()
}

/**
 * The first blocking reason (in the DB's guard order) for redeeming ONE session
 * of this package against `serviceId`, or null when it can be redeemed.
 * Passing serviceId undefined skips the service check (e.g. rendering a counter).
 */
export function redeemBlock(
  pkg: CustomerPackage,
  serviceId?: string,
  now: Date = new Date(),
): RedeemBlock | null {
  if (pkg.paymentStatus !== 'paid') return 'not_paid'
  if (isPackageExpired(pkg.expiresAt, now)) return 'expired'
  if (serviceId != null && pkg.packageServiceId != null && pkg.packageServiceId !== serviceId) {
    return 'service_mismatch'
  }
  if (packageRemaining(pkg) <= 0) return 'exhausted'
  return null
}

/** Can one session be redeemed for this (optional) service right now? */
export function isRedeemable(pkg: CustomerPackage, serviceId?: string, now: Date = new Date()): boolean {
  return redeemBlock(pkg, serviceId, now) === null
}

/**
 * Series pre-check mirror: can this package cover `count` occurrences of
 * `serviceId`? True only when the package is otherwise redeemable AND has at
 * least `count` sessions left — the same rule create_recurrence_series enforces
 * before generating a series (so the consumption trigger never trips mid-loop).
 */
export function hasEnoughSessions(
  pkg: CustomerPackage,
  count: number,
  serviceId?: string,
  now: Date = new Date(),
): boolean {
  if (count <= 0) return false
  // Service/paid/expiry must pass; the "exhausted" reason is subsumed by the
  // remaining ≥ count check below, so ignore a 0-remaining block here.
  const block = redeemBlock(pkg, serviceId, now)
  if (block != null && block !== 'exhausted') return false
  return packageRemaining(pkg) >= count
}

/** Package a customer can still draw from (paid, unexpired, has sessions). */
export function activePackagesForService(
  pkgs: CustomerPackage[],
  serviceId?: string,
  now: Date = new Date(),
): CustomerPackage[] {
  return pkgs.filter(p => isRedeemable(p, serviceId, now))
}

/**
 * Parse a customer_packages row (snake_case, with an embedded packages relation)
 * into the typed shape. PostgREST returns numerics as strings, so coerce.
 */
export function parseCustomerPackage(raw: unknown): CustomerPackage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!r.id) return null
  // Accepts either a PostgREST embed ({ packages: { service_id } }) or the flat
  // get_org_customer_packages RPC row ({ service_id }).
  const pkgRel = r.packages as Record<string, unknown> | null | undefined
  const svc = pkgRel?.service_id ?? r.service_id
  return {
    id: String(r.id),
    sessionsTotal: Number(r.sessions_total ?? 0),
    sessionsUsed: Number(r.sessions_used ?? 0),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    paymentStatus: (r.payment_status as CustomerPackage['paymentStatus']) ?? 'pending',
    packageServiceId: svc != null ? String(svc) : null,
  }
}
