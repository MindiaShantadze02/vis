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

/**
 * Georgian phone input → E.164 (`+995XXXXXXXXX`), the format Supabase Auth
 * requires for phone sign-in/up. Call only on values that pass
 * isValidGeorgianPhone.
 */
export function toE164Georgian(raw: string): string {
  return `+995${formatGeorgianPhone(raw)}`
}

/**
 * A stored phone (bare 9-digit, "995…", or "+995…" — Supabase returns
 * user.phone as "995XXXXXXXXX") → a readable "+995 5XX XX XX XX". Falls back to
 * the raw value if it isn't a 9-digit national number.
 */
export function displayGeorgianPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const local = formatGeorgianPhone(raw)
  if (local.length !== 9) return raw
  return `+995 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`
}

/**
 * Pragmatic email check — a non-empty local part, an "@", and a dotted
 * domain. Deliberately loose (full RFC 5322 is impractical and rejects valid
 * addresses); mirrors the invitations_email_format DB constraint.
 */
export function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim())
}

/**
 * A person's name: letters only — no digits or punctuation/symbols. Spaces,
 * hyphens and apostrophes are allowed because real names use them
 * (e.g. "Anne-Marie", "O'Brien", composite Georgian names), but at least one
 * actual letter is required so " - " or "''" don't pass. Uses the Unicode
 * letter class (\p{L}) so Georgian (მარიამ) and Latin names both validate.
 * Mirrors the customers_*_name_letters DB constraint.
 */
export function isValidPersonName(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  return /\p{L}/u.test(trimmed) && /^[\p{L}\p{M} '’-]+$/u.test(trimmed)
}

/**
 * True when `raw` is a well-formed http(s) URL. Used to validate the meeting
 * link required for online services. We rely on the URL constructor (handles
 * the awkward edge cases) and only insist on an http/https scheme so users
 * can't paste a bare host or a `mailto:`/`javascript:` value.
 */
export function isValidUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * True when `raw` looks like a canonical UUID. The public capability pages
 * (/manage, /review, /booking-confirmation) take an appointment id straight
 * from the URL; guarding with this before the RPC means a malformed id renders
 * "not found" locally instead of firing a Postgres 22P02 (400 + console noise).
 */
export function isUuid(raw: string | undefined | null): boolean {
  return !!raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
}

/**
 * Maximum lengths for free-text fields, in one place so forms cap inputs
 * consistently. Values mirror the DB `varchar(N)` columns where they exist
 * (organisations/services name 255, customer names 100, slug 100); `text`
 * columns have no DB cap, so these are sensible app-level limits.
 */
export const FIELD_LIMITS = {
  orgName: 255,
  address: 255,
  serviceName: 255,
  personName: 100,
  description: 1000,
  notes: 500,
  title: 100,
  note: 300,
  meetingLink: 500,
  email: 254,
  phone: 20,
  password: 72,
  paymentField: 255,
} as const

/**
 * Minimum password length. Enforced on register / reset / change-password in
 * the client and in the reset-password edge function (MIN_PASSWORD — keep in
 * sync). Lowered 10 → 8 on 2026-07-12.
 */
export const PASSWORD_MIN = 8

/** Largest value the numeric(10,2) price column can hold. */
export const MAX_PRICE = 99999999.99

/** True for a finite number ≥ 0 (rejects negatives and NaN). */
export function isNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** Logos must be an image no larger than this. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024

/**
 * Validate a logo/image upload before sending it to storage. Returns a
 * `validation.*` i18n key suffix describing the problem, or null when fine.
 */
export function imageFileError(file: File): 'invalidImage' | 'fileTooLarge' | null {
  if (!file.type.startsWith('image/')) return 'invalidImage'
  if (file.size > MAX_LOGO_BYTES) return 'fileTooLarge'
  return null
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
