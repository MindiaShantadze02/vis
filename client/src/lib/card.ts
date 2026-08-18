/**
 * Card-input formatting + parsing for Settings → Billing.
 *
 * The form used to demand an exact shape — the expiry only matched
 * /^\d{2}\s*\/\s*\d{2}$/, so "0929", "9/29" and a pasted "09 / 2029" were all
 * rejected as invalid even though the card was fine. These helpers reformat as
 * the owner types instead: whatever they enter is normalised, and parsing
 * accepts every reasonable spelling rather than one.
 *
 * All pure — no PAN ever leaves the browser (the form tokenises before calling
 * save-card), and nothing here stores or logs a value.
 */

/** Longest PAN any scheme issues (ISO/IEC 7812). */
const MAX_PAN_DIGITS = 19

/** American Express: 15 digits, grouped 4-6-5 rather than in fours. */
function isAmex(digits: string): boolean {
  return /^3[47]/.test(digits)
}

/**
 * Group a card number for display: "4242424242424242" → "4242 4242 4242 4242",
 * Amex → "3782 822463 10005". Non-digits are dropped, so pasting a number with
 * dashes, spaces or non-breaking spaces works. Capped at 19 digits.
 */
export function formatCardNumber(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, MAX_PAN_DIGITS)
  if (!digits) return ''

  const groups = isAmex(digits) ? [4, 6, 5] : [4, 4, 4, 4, 3]
  const out: string[] = []
  let i = 0
  for (const size of groups) {
    if (i >= digits.length) break
    out.push(digits.slice(i, i + size))
    i += size
  }
  // Anything past the last group (a 19-digit non-Amex PAN) trails on unchanged.
  if (i < digits.length) out.push(digits.slice(i))
  return out.join(' ')
}

/**
 * Format an expiry as the owner types, towards "MM/YY".
 *
 * Deliberately does NOT append the slash at exactly two digits: leaving it off
 * keeps backspace working (with it, deleting the slash would re-add it and the
 * field would be stuck at "MM/"). The slash appears as soon as a year digit is
 * typed, which is the moment it means anything.
 *
 * A single digit above 1 is unambiguous as a month, so "9" becomes "09". A
 * pasted 4-digit year is narrowed to its last two ("09/2029" → "09/29").
 */
export function formatCardExpiry(input: string): string {
  // An explicit separator settles which digits are the month. Without this the
  // digits get read positionally and "9/28" becomes "92/8" — the month the
  // owner clearly meant is lost.
  const sep = /^\s*(\d{1,2})\s*[^\d\s]\s*(\d*)\s*$/.exec(input)
  if (sep) {
    const mm = sep[1].length === 1 ? `0${sep[1]}` : sep[1]
    const yy = narrowYear(sep[2])
    // Keep the separator the owner typed, so it doesn't flicker away mid-entry.
    return yy ? `${mm}/${yy}` : `${mm}/`
  }

  // 6 rather than 4 so a pasted 4-digit year survives to be narrowed below.
  const digits = input.replace(/\D/g, '').slice(0, 6)
  if (!digits) return ''

  // "3" can only be March; "1" could still become 10/11/12, so leave it alone.
  if (digits.length === 1) return digits >= '2' ? `0${digits}` : digits

  const mm = digits.slice(0, 2)
  const yy = narrowYear(digits.slice(2))
  return yy ? `${mm}/${yy}` : mm
}

/** "2029" → "29"; anything else is taken as already-two-digit and capped. */
function narrowYear(raw: string): string {
  const y = raw.replace(/\D/g, '')
  if (y.length === 4 && (y.startsWith('19') || y.startsWith('20'))) return y.slice(2)
  return y.slice(0, 2)
}

export interface CardExpiry {
  /** 1-12. */
  month: number
  /** Four digits. */
  year: number
}

/**
 * Parse an expiry the owner typed, in whatever shape it arrived: "09/29",
 * "0929", "9/29", "09 / 2029", "9-2029". Returns null when it isn't a coherent
 * month/year — including a month outside 1-12.
 *
 * Does NOT judge whether the card is expired; that's `isExpiryInFuture`, kept
 * separate so a test can pin "parsed correctly" apart from "still valid".
 */
export function parseCardExpiry(input: string): CardExpiry | null {
  const raw = input.trim()
  if (!raw) return null

  let mmPart: string
  let yyPart: string

  // Explicit separator ("9/29") settles the ambiguity a bare digit run can't.
  const split = /^(\d{1,2})\s*[^\d\s]\s*(\d{2}|\d{4})$/.exec(raw)
  if (split) {
    mmPart = split[1]
    yyPart = split[2]
  } else {
    const digits = raw.replace(/\D/g, '')
    // Fixed widths: MMYY or MMYYYY. A 3-digit run is genuinely ambiguous
    // (M-YY or MM-Y), so it is rejected rather than guessed at.
    if (digits.length === 4) { mmPart = digits.slice(0, 2); yyPart = digits.slice(2) }
    else if (digits.length === 6) { mmPart = digits.slice(0, 2); yyPart = digits.slice(2) }
    else return null
  }

  const month = Number(mmPart)
  if (!Number.isInteger(month) || month < 1 || month > 12) return null

  const y = Number(yyPart)
  if (!Number.isInteger(y)) return null
  // Two digits are this century — the only reading that makes sense for a card
  // that must not already be expired.
  const year = yyPart.length === 2 ? 2000 + y : y
  if (year < 2000 || year > 2100) return null

  return { month, year }
}

/**
 * Whether an expiry is still in the future. A card is valid through the END of
 * its expiry month, so December 2029 stays valid until 2030-01-01.
 */
export function isExpiryInFuture(exp: CardExpiry, now: Date = new Date()): boolean {
  // Day 0 of the following month = the last day of the expiry month.
  return Date.UTC(exp.year, exp.month, 0, 23, 59, 59) >= now.getTime()
}

/** Digit count a PAN must fall within to be plausible (ISO/IEC 7812). */
export function isPlausibleCardNumber(input: string): boolean {
  const digits = input.replace(/\D/g, '')
  return digits.length >= 13 && digits.length <= MAX_PAN_DIGITS
}

/** Card brand from the IIN — display only; a real provider returns the brand. */
export function detectCardBrand(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.startsWith('4')) return 'visa'
  if (/^5[1-5]/.test(digits)) return 'mastercard'
  if (isAmex(digits)) return 'amex'
  return 'card'
}
