/**
 * Owner analytics — the client mirror of the get_org_analytics(org, from, to)
 * RPC (migration 096). Pre-aggregated numbers for a date range; the client only
 * coerces (PostgREST hands numeric back as strings) and formats.
 */

export interface StaffRevenue {
  name: string
  revenue: number
}

export interface OrgAnalytics {
  revenue: number
  bookings: number
  completed: number
  cancelled: number
  no_show: number
  // Count of bookings prepaid online (full payment or deposit) in the range.
  deposits_collected: number
  no_show_rate: number | null
  cancellation_rate: number | null
  repeat_rate: number | null
  revenue_by_staff: StaffRevenue[]
  by_weekday: number[] // 7, Mon→Sun
  by_hour: number[]    // 24, 0→23
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))
const rate = (v: unknown): number | null => (v == null ? null : Number(v))

export function parseAnalytics(raw: unknown): OrgAnalytics | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    revenue: num(r.revenue),
    bookings: num(r.bookings),
    completed: num(r.completed),
    cancelled: num(r.cancelled),
    no_show: num(r.no_show),
    deposits_collected: num(r.deposits_collected),
    no_show_rate: rate(r.no_show_rate),
    cancellation_rate: rate(r.cancellation_rate),
    repeat_rate: rate(r.repeat_rate),
    revenue_by_staff: Array.isArray(r.revenue_by_staff)
      ? (r.revenue_by_staff as Record<string, unknown>[]).map(s => ({ name: String(s.name ?? '—'), revenue: num(s.revenue) }))
      : [],
    by_weekday: Array.isArray(r.by_weekday) ? (r.by_weekday as unknown[]).map(num) : Array(7).fill(0),
    by_hour: Array.isArray(r.by_hour) ? (r.by_hour as unknown[]).map(num) : Array(24).fill(0),
  }
}

/** A 0–1 rate as a rounded percentage; em dash when there's no denominator. */
export function pct(r: number | null): string {
  return r == null ? '—' : `${Math.round(r * 100)}%`
}
