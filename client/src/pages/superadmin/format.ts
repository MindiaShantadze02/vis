/**
 * Formatting helpers for the superadmin console. Kept out of _shared.tsx because
 * a module that exports both components and plain functions breaks React fast
 * refresh (react-refresh/only-export-components).
 */

export const lari = (n: number | null | undefined) => `₾${Number(n ?? 0).toFixed(2)}`

export const dateTime = (s: string | null) =>
  s
    ? new Date(s).toLocaleString('ka-GE', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : '—'

const MONTHS = [
  'იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი',
  'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი',
]

/** "2026-08" -> "აგვისტო 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const idx = Number(m) - 1
  return MONTHS[idx] ? `${MONTHS[idx]} ${y}` : ym
}
