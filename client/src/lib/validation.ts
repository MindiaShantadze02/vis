/**
 * Shared client-side validators used across booking, onboarding, and
 * settings forms so validation rules live in one place.
 */

/**
 * Georgian phone numbers: 9-digit local numbers starting with 5 (mobile)
 * or 3/4 (landline), optionally prefixed with the +995 country code.
 * Spaces, dashes, and parentheses are ignored.
 */
export function isValidGeorgianPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  const local = digits.startsWith('995') ? digits.slice(3) : digits
  return local.length === 9 && /^[345]/.test(local)
}

/** "HH:mm" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** True when `end` is strictly after `start` (both "HH:mm"). */
export function isEndAfterStart(start: string, end: string): boolean {
  return timeToMinutes(end) > timeToMinutes(start)
}

/**
 * True when any two ranges in the list overlap. Ranges are
 * `{ start, end }` with "HH:mm" values.
 */
export function hasOverlap(ranges: { start: string; end: string }[]): boolean {
  const sorted = [...ranges].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
  for (let i = 1; i < sorted.length; i++) {
    if (timeToMinutes(sorted[i].start) < timeToMinutes(sorted[i - 1].end)) return true
  }
  return false
}
