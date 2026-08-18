import { describe, expect, it } from 'vitest'
import {
  formatCardNumber, formatCardExpiry, parseCardExpiry, isExpiryInFuture,
  isPlausibleCardNumber, detectCardBrand,
} from './card'

describe('formatCardNumber', () => {
  it('groups a 16-digit PAN in fours', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
  })

  it('groups Amex 4-6-5', () => {
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005')
  })

  it('strips whatever separators were pasted', () => {
    expect(formatCardNumber('4242-4242-4242-4242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('4242 4242 4242 4242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('  4242 4242.4242,4242 ')).toBe('4242 4242 4242 4242')
  })

  it('formats partial input as it is typed', () => {
    expect(formatCardNumber('4')).toBe('4')
    expect(formatCardNumber('4242')).toBe('4242')
    expect(formatCardNumber('42424')).toBe('4242 4')
  })

  it('caps at 19 digits and still groups the tail', () => {
    expect(formatCardNumber('12345678901234567890')).toBe('1234 5678 9012 3456 789')
  })

  it('is empty for input with no digits', () => {
    expect(formatCardNumber('')).toBe('')
    expect(formatCardNumber('abc')).toBe('')
  })
})

describe('formatCardExpiry', () => {
  it('pads a single unambiguous month digit', () => {
    expect(formatCardExpiry('9')).toBe('09')
    expect(formatCardExpiry('2')).toBe('02')
  })

  it('leaves "1" alone — it could still become 10, 11 or 12', () => {
    expect(formatCardExpiry('1')).toBe('1')
    expect(formatCardExpiry('12')).toBe('12')
  })

  it('adds the slash only once a year digit arrives', () => {
    // No trailing slash at two digits, so backspace can get back out.
    expect(formatCardExpiry('09')).toBe('09')
    expect(formatCardExpiry('092')).toBe('09/2')
    expect(formatCardExpiry('0929')).toBe('09/29')
  })

  it('normalises whatever separator was typed', () => {
    expect(formatCardExpiry('09/29')).toBe('09/29')
    expect(formatCardExpiry('09 / 29')).toBe('09/29')
    expect(formatCardExpiry('09-29')).toBe('09/29')
  })

  it('respects an explicit separator instead of reading digits positionally', () => {
    // The bug this guards: without the separator branch "9/29" reads as
    // month 92, year 9.
    expect(formatCardExpiry('9/29')).toBe('09/29')
    expect(formatCardExpiry('9 / 2029')).toBe('09/29')
    expect(formatCardExpiry('9-29')).toBe('09/29')
  })

  it('keeps a separator the owner just typed, and lets backspace past it', () => {
    expect(formatCardExpiry('09/')).toBe('09/')
    expect(formatCardExpiry('9/')).toBe('09/')
    // Deleting the slash must not re-add it, or the field sticks at "09/".
    expect(formatCardExpiry('09')).toBe('09')
  })

  it('narrows a pasted 4-digit year', () => {
    expect(formatCardExpiry('09/2029')).toBe('09/29')
    expect(formatCardExpiry('092029')).toBe('09/29')
  })

  it('is empty for input with no digits', () => {
    expect(formatCardExpiry('')).toBe('')
    expect(formatCardExpiry('/')).toBe('')
  })
})

describe('parseCardExpiry', () => {
  it('accepts every spelling the old regex rejected', () => {
    const want = { month: 9, year: 2029 }
    expect(parseCardExpiry('09/29')).toEqual(want)
    expect(parseCardExpiry('0929')).toEqual(want)
    expect(parseCardExpiry('9/29')).toEqual(want)
    expect(parseCardExpiry('09 / 2029')).toEqual(want)
    expect(parseCardExpiry('9-2029')).toEqual(want)
    expect(parseCardExpiry('  09/29  ')).toEqual(want)
  })

  it('reads a 4-digit year as written', () => {
    expect(parseCardExpiry('12/2031')).toEqual({ month: 12, year: 2031 })
  })

  it('rejects an out-of-range month', () => {
    expect(parseCardExpiry('13/29')).toBeNull()
    expect(parseCardExpiry('00/29')).toBeNull()
    expect(parseCardExpiry('1329')).toBeNull()
  })

  it('rejects genuinely ambiguous or incomplete input', () => {
    expect(parseCardExpiry('929')).toBeNull()   // M-YY or MM-Y?
    expect(parseCardExpiry('09')).toBeNull()
    expect(parseCardExpiry('')).toBeNull()
    expect(parseCardExpiry('ab/cd')).toBeNull()
  })

  it('keeps the month boundary at 1 and 12', () => {
    expect(parseCardExpiry('01/29')).toEqual({ month: 1, year: 2029 })
    expect(parseCardExpiry('12/29')).toEqual({ month: 12, year: 2029 })
  })
})

describe('isExpiryInFuture', () => {
  const now = new Date('2026-08-18T12:00:00Z')

  it('is valid through the last day of the expiry month', () => {
    expect(isExpiryInFuture({ month: 8, year: 2026 }, now)).toBe(true)
    expect(isExpiryInFuture({ month: 8, year: 2026 }, new Date('2026-08-31T23:00:00Z'))).toBe(true)
  })

  it('expires once the month has passed', () => {
    expect(isExpiryInFuture({ month: 7, year: 2026 }, now)).toBe(false)
    expect(isExpiryInFuture({ month: 8, year: 2026 }, new Date('2026-09-01T00:00:01Z'))).toBe(false)
  })

  it('accepts a future month', () => {
    expect(isExpiryInFuture({ month: 9, year: 2026 }, now)).toBe(true)
    expect(isExpiryInFuture({ month: 1, year: 2030 }, now)).toBe(true)
  })
})

describe('isPlausibleCardNumber', () => {
  it('holds the 13 and 19 digit boundaries', () => {
    expect(isPlausibleCardNumber('1'.repeat(12))).toBe(false)
    expect(isPlausibleCardNumber('1'.repeat(13))).toBe(true)
    expect(isPlausibleCardNumber('1'.repeat(19))).toBe(true)
    expect(isPlausibleCardNumber('1'.repeat(20))).toBe(false)
  })

  it('counts digits, not formatting', () => {
    expect(isPlausibleCardNumber('4242 4242 4242 4242')).toBe(true)
    expect(isPlausibleCardNumber('')).toBe(false)
  })
})

describe('detectCardBrand', () => {
  it('reads the brand off the IIN, formatted or not', () => {
    expect(detectCardBrand('4242 4242 4242 4242')).toBe('visa')
    expect(detectCardBrand('5555555555554444')).toBe('mastercard')
    expect(detectCardBrand('378282246310005')).toBe('amex')
    expect(detectCardBrand('6011111111111117')).toBe('card')
  })
})
