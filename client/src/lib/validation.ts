/**
 * Shared client-side validators used across booking, onboarding, and
 * settings forms so validation rules live in one place.
 */

/**
 * Georgian phone numbers (country code +995). The national number is always
 * 9 digits:
 *   - mobile  → starts with 5 (5XX XXX XXX). All operators — Magti, Silknet
 *     (Geocell), Cellfie (ex-Beeline) — share the 5XX space, and with number
 *     portability the 5XX prefix no longer maps to a fixed operator, so we
 *     only require a leading 5 rather than an operator-specific prefix list.
 *   - landline → starts with 3 or 4 (area code + subscriber, e.g. Tbilisi 32).
 * The +995 country code is optional on input; spaces, dashes, and parentheses
 * are ignored.
 */
export function isValidGeorgianPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  const local = digits.startsWith('995') ? digits.slice(3) : digits
  return local.length === 9 && /^[345]/.test(local)
}

/**
 * Normalise any accepted Georgian phone input to the bare 9-digit national
 * number (e.g. "599123456"). Drops spaces/dashes and a leading +995/995 if the
 * user pasted one — we deliberately don't store the country code, as it only
 * confuses local customers. Call only on values that pass isValidGeorgianPhone;
 * storing one consistent form keeps lookups/dedup reliable across the app.
 */
export function formatGeorgianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('995') ? digits.slice(3) : digits
}

/** "HH:mm" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Minutes since midnight → "HH:mm" (clamped to 00:00–23:59). */
export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(min, 23 * 60 + 59))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

/** Clamp a "HH:mm" value to the inclusive [min, max] window (both "HH:mm"). */
export function clampTime(value: string, min: string, max: string): string {
  const v = timeToMinutes(value)
  const lo = timeToMinutes(min)
  const hi = timeToMinutes(max)
  if (v < lo) return min
  if (v > hi) return max
  return value
}

export interface TimeRange { start: string; end: string }

/**
 * A day expressed the way admins think about it: a single working window
 * (open → close) with explicit breaks carved out of it. This is the editable
 * shape; storage uses working ranges (the gaps between breaks).
 */
export interface DaySchedule {
  open: boolean
  openTime: string
  closeTime: string
  breaks: TimeRange[]
}

/**
 * Stored working ranges → editable open/close window + breaks.
 * The first range's start is the open time, the last range's end is the close
 * time, and each gap between consecutive ranges becomes a break.
 */
export function rangesToSchedule(open: boolean, ranges: TimeRange[]): DaySchedule {
  if (!ranges || ranges.length === 0) {
    return { open, openTime: '09:00', closeTime: '18:00', breaks: [] }
  }
  const sorted = [...ranges].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
  const breaks: TimeRange[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    breaks.push({ start: sorted[i].end, end: sorted[i + 1].start })
  }
  return {
    open,
    openTime: sorted[0].start,
    closeTime: sorted[sorted.length - 1].end,
    breaks,
  }
}

/**
 * Editable open/close window + breaks → stored working ranges. Working ranges
 * are the segments of [open, close] that aren't covered by a break. Zero-length
 * or inverted segments are dropped.
 */
export function scheduleToRanges(openTime: string, closeTime: string, breaks: TimeRange[]): TimeRange[] {
  const sorted = [...breaks]
    .filter(b => isEndAfterStart(b.start, b.end))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
  const ranges: TimeRange[] = []
  let cursor = openTime
  for (const b of sorted) {
    if (isEndAfterStart(cursor, b.start)) ranges.push({ start: cursor, end: b.start })
    cursor = b.end
  }
  if (isEndAfterStart(cursor, closeTime)) ranges.push({ start: cursor, end: closeTime })
  return ranges
}

/**
 * Validate one day's editable schedule. Returns a `validation.*` i18n key
 * suffix describing the first problem found, or null when valid.
 */
export function dayScheduleIssue(
  openTime: string,
  closeTime: string,
  breaks: TimeRange[],
): 'endBeforeStart' | 'breakOutsideHours' | 'rangeOverlap' | null {
  if (!isEndAfterStart(openTime, closeTime)) return 'endBeforeStart'
  for (const b of breaks) {
    if (!isEndAfterStart(b.start, b.end)) return 'endBeforeStart'
    if (timeToMinutes(b.start) < timeToMinutes(openTime) || timeToMinutes(b.end) > timeToMinutes(closeTime)) {
      return 'breakOutsideHours'
    }
  }
  if (hasOverlap(breaks)) return 'rangeOverlap'
  return null
}
