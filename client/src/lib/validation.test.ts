import { describe, expect, it } from 'vitest'
import {
  isValidGeorgianPhone,
  formatGeorgianPhone,
  toE164Georgian,
  displayGeorgianPhone,
  isValidEmail,
  isValidPersonName,
  isValidUrl,
  isUuid,
  isNonNegativeNumber,
  imageFileError,
  MAX_PRICE,
  MIN_PRICE,
  isValidServicePrice,
  timeToMinutes,
  minutesToTime,
  isEndAfterStart,
  hasOverlap,
  clampTime,
  rangesToSchedule,
  scheduleToRanges,
  dayScheduleIssue,
  type TimeRange,
} from './validation'

/**
 * Unit tests for the shared validators, written against formal test-design
 * techniques rather than ad-hoc examples:
 *  - Equivalence Class Partitioning (ECP) — one representative per input class.
 *  - Boundary Value Analysis (BVA) — values on/around each accept/reject edge.
 *  - Decision & Path coverage — every branch/return of each function.
 *  - Data-flow — inputs that exercise a value through strip → transform → check.
 * Goal: 100% statement + branch coverage of src/lib/validation.ts.
 */

describe('isValidGeorgianPhone', () => {
  // ECP — valid partitions: mobile (5xx), landline (3xx / 4xx).
  it.each([
    ['mobile 5xx', '599123456'],
    ['landline 3xx (Tbilisi)', '322123456'],
    ['landline 4xx', '431123456'],
  ])('accepts a valid %s national number', (_label, value) => {
    expect(isValidGeorgianPhone(value)).toBe(true)
  })

  // ECP — invalid leading-digit partition. 0,1,2,6,7,8,9 are all rejected.
  it.each(['099123456', '199123456', '299123456', '699123456', '799123456', '899123456', '999123456'])(
    'rejects national number with invalid leading digit (%s)',
    value => {
      expect(isValidGeorgianPhone(value)).toBe(false)
    },
  )

  // BVA — length boundary is exactly 9 digits.
  it('rejects 8 digits (one below the boundary)', () => {
    expect(isValidGeorgianPhone('59912345')).toBe(false)
  })
  it('accepts 9 digits (on the boundary)', () => {
    expect(isValidGeorgianPhone('599123456')).toBe(true)
  })
  it('rejects 10 digits (one above the boundary)', () => {
    expect(isValidGeorgianPhone('5991234567')).toBe(false)
  })

  // Data-flow — the raw string flows through replace(/\D/g,'') then the 995 strip.
  it('accepts a +995-prefixed number (country code stripped)', () => {
    expect(isValidGeorgianPhone('+995599123456')).toBe(true)
  })
  it('accepts a 995-prefixed number without the plus', () => {
    expect(isValidGeorgianPhone('995599123456')).toBe(true)
  })
  it('accepts a number with spaces, dashes and parens', () => {
    expect(isValidGeorgianPhone('+995 (599) 12-34-56')).toBe(true)
  })
  it('rejects the empty string', () => {
    expect(isValidGeorgianPhone('')).toBe(false)
  })
  it('rejects a non-numeric string', () => {
    expect(isValidGeorgianPhone('not a phone')).toBe(false)
  })
})

describe('formatGeorgianPhone', () => {
  // Both branches of the `startsWith('995')` decision.
  it('strips a 995 country code', () => {
    expect(formatGeorgianPhone('995599123456')).toBe('599123456')
  })
  it('strips a +995 country code (non-digits removed first)', () => {
    expect(formatGeorgianPhone('+995 599 123 456')).toBe('599123456')
  })
  it('leaves a bare national number unchanged', () => {
    expect(formatGeorgianPhone('599123456')).toBe('599123456')
  })
})

describe('toE164Georgian', () => {
  it('prefixes +995 to the normalised national number', () => {
    expect(toE164Georgian('599123456')).toBe('+995599123456')
  })
  it('does not double the country code when input already has 995', () => {
    expect(toE164Georgian('995599123456')).toBe('+995599123456')
  })
})

describe('displayGeorgianPhone', () => {
  // Path coverage: null/undefined/empty early-return, valid formatting, fallback.
  it.each([[null], [undefined], ['']])('returns "" for empty input (%s)', value => {
    expect(displayGeorgianPhone(value)).toBe('')
  })
  it('formats a 9-digit national number into grouped display form', () => {
    expect(displayGeorgianPhone('599123456')).toBe('+995 599 12 34 56')
  })
  it('formats a stored 995-prefixed number (Supabase form)', () => {
    expect(displayGeorgianPhone('995599123456')).toBe('+995 599 12 34 56')
  })
  it('falls back to the raw value when it is not a 9-digit number', () => {
    expect(displayGeorgianPhone('12345')).toBe('12345')
  })
})

describe('isValidEmail', () => {
  // ECP — valid partition.
  it.each(['a@b.co', 'user.name@example.com', 'x@y.z.dev'])('accepts a valid address (%s)', value => {
    expect(isValidEmail(value)).toBe(true)
  })
  // Data-flow — leading/trailing whitespace is trimmed before the regex.
  it('accepts an address padded with whitespace (trim path)', () => {
    expect(isValidEmail('  a@b.co  ')).toBe(true)
  })
  // Error-guessing / invalid partitions.
  it.each([
    ['missing @', 'ab.co'],
    ['missing dot in domain', 'a@bco'],
    ['double @', 'a@@b.co'],
    ['space inside', 'a b@c.co'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidEmail(value)).toBe(false)
  })
})

describe('isValidPersonName', () => {
  // Decision coverage — the two regex clauses (has-a-letter AND allowed-chars-only).
  it.each([
    ["O'Brien (apostrophe)", "O'Brien"],
    ['Anne-Marie (hyphen)', 'Anne-Marie'],
    ['Georgian script', 'მარიამ'],
    ['single letter', 'A'],
    ['curly apostrophe', 'O’Brien'],
  ])('accepts %s', (_label, value) => {
    expect(isValidPersonName(value)).toBe(true)
  })
  it.each([
    ['punctuation-only, no letter', ' - '],
    ['apostrophes only, no letter', "''"],
    ['contains a digit', 'a1'],
    ['contains a symbol', 'Bob!'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, value) => {
    expect(isValidPersonName(value)).toBe(false)
  })
})

describe('isValidUrl', () => {
  // Path coverage — both the try-success and the catch branches.
  it.each(['http://example.com', 'https://example.com/book?x=1'])('accepts http(s) URL (%s)', value => {
    expect(isValidUrl(value)).toBe(true)
  })
  it.each([
    ['mailto scheme', 'mailto:a@b.co'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['bare host (no scheme → throws)', 'example.com'],
    ['garbage (throws)', 'not a url'],
    ['empty (throws)', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidUrl(value)).toBe(false)
  })
})

describe('isUuid', () => {
  it.each([
    '4231f03e-f733-4f82-b1e2-e2ebd8e2ba39',
    '00000000-0000-0000-0000-000000000000',
    'A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D', // upper-case is accepted
  ])('accepts a canonical uuid (%s)', v => expect(isUuid(v)).toBe(true))

  it.each([
    ['too short', 'not-a-real-uuid-12345'],
    ['missing dashes', '4231f03ef7334f82b1e2e2ebd8e2ba39'],
    ['non-hex chars', 'gggggggg-gggg-gggg-gggg-gggggggggggg'],
    ['trailing junk', '4231f03e-f733-4f82-b1e2-e2ebd8e2ba39x'],
    ['empty', ''],
  ])('rejects %s', (_label, v) => expect(isUuid(v)).toBe(false))

  it('rejects null/undefined', () => {
    expect(isUuid(null)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})

describe('isValidServicePrice', () => {
  // BVA around both ends of [MIN_PRICE, MAX_PRICE]. Free services were removed
  // 2026-08-12, so 0 — long the lower boundary — is now firmly invalid.
  it.each([
    ['zero (was the old floor)', 0, false],
    ['just below MIN_PRICE', 4.99, false],
    ['MIN_PRICE (boundary)', MIN_PRICE, true],
    ['just above MIN_PRICE', 5.01, true],
    ['MAX_PRICE (boundary)', MAX_PRICE, true],
    ['just above MAX_PRICE', 100000000, false],
    ['negative', -1, false],
    ['NaN', NaN, false],
    ['Infinity', Infinity, false],
  ])('%s → %s', (_label, value, expected) => {
    expect(isValidServicePrice(value as number)).toBe(expected)
  })
})

describe('isNonNegativeNumber', () => {
  // Still the deposit-value validator (deposits may legitimately be 0).
  // BVA around the 0 boundary and the MAX_PRICE ceiling; plus non-finite rejects.
  it.each([
    ['just below zero', -0.01, false],
    ['zero (boundary)', 0, true],
    ['just above zero', 0.01, true],
    ['MAX_PRICE', MAX_PRICE, true],
    ['NaN', NaN, false],
    ['Infinity', Infinity, false],
    ['-Infinity', -Infinity, false],
  ])('%s → %s', (_label, value, expected) => {
    expect(isNonNegativeNumber(value as number)).toBe(expected)
  })
})

describe('imageFileError', () => {
  const MB = 1024 * 1024
  // imageFileError only reads .type and .size, so a lightweight stub avoids
  // having to allocate a real multi-megabyte File in the test.
  const makeFile = (type: string, bytes: number): File => ({ type, size: bytes } as File)

  it('rejects a non-image type', () => {
    expect(imageFileError(makeFile('application/pdf', 100))).toBe('invalidImage')
  })
  // BVA on the 2 MB (MAX_LOGO_BYTES) ceiling.
  it('accepts an image exactly at the 2 MB boundary', () => {
    expect(imageFileError(makeFile('image/png', 2 * MB))).toBeNull()
  })
  it('rejects an image one byte over 2 MB', () => {
    expect(imageFileError(makeFile('image/png', 2 * MB + 1))).toBe('fileTooLarge')
  })
})

describe('time helpers', () => {
  it('timeToMinutes converts "HH:mm" to minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
  })

  // BVA on the minutesToTime clamp [0 .. 1439].
  it.each([
    [-1, '00:00'],
    [0, '00:00'],
    [570, '09:30'],
    [1439, '23:59'],
    [1440, '23:59'],
    [5000, '23:59'],
  ])('minutesToTime(%i) → %s (clamped)', (min, expected) => {
    expect(minutesToTime(min)).toBe(expected)
  })

  // BVA — strict "after", so equal times are NOT after.
  it('isEndAfterStart is strict at the equal boundary', () => {
    expect(isEndAfterStart('09:00', '09:00')).toBe(false)
    expect(isEndAfterStart('09:00', '09:01')).toBe(true)
    expect(isEndAfterStart('09:01', '09:00')).toBe(false)
  })

  // ECP — disjoint, touching, overlapping.
  it('hasOverlap: disjoint ranges do not overlap', () => {
    expect(hasOverlap([{ start: '09:00', end: '10:00' }, { start: '11:00', end: '12:00' }])).toBe(false)
  })
  it('hasOverlap: touching ranges (end === next start) do not overlap', () => {
    expect(hasOverlap([{ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }])).toBe(false)
  })
  it('hasOverlap: overlapping ranges are detected regardless of input order', () => {
    expect(hasOverlap([{ start: '11:00', end: '12:00' }, { start: '10:00', end: '11:30' }])).toBe(true)
  })

  // clampTime — below / inside / above the window.
  it('clampTime clamps below, keeps inside, clamps above', () => {
    expect(clampTime('08:00', '09:00', '18:00')).toBe('09:00')
    expect(clampTime('12:00', '09:00', '18:00')).toBe('12:00')
    expect(clampTime('19:00', '09:00', '18:00')).toBe('18:00')
  })
})

describe('rangesToSchedule / scheduleToRanges (data-flow round-trip)', () => {
  it('rangesToSchedule falls back to defaults for no ranges', () => {
    expect(rangesToSchedule(false, [])).toEqual({ open: false, openTime: '09:00', closeTime: '18:00', breaks: [] })
  })

  it('rangesToSchedule derives open/close + the gap between ranges as a break', () => {
    const ranges: TimeRange[] = [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ]
    expect(rangesToSchedule(true, ranges)).toEqual({
      open: true,
      openTime: '09:00',
      closeTime: '18:00',
      breaks: [{ start: '13:00', end: '14:00' }],
    })
  })

  it('scheduleToRanges carves breaks out of the working window', () => {
    expect(scheduleToRanges('09:00', '18:00', [{ start: '13:00', end: '14:00' }])).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '18:00' },
    ])
  })

  it('scheduleToRanges sorts out-of-order breaks before carving (multi-break)', () => {
    expect(
      scheduleToRanges('09:00', '18:00', [
        { start: '15:00', end: '16:00' },
        { start: '12:00', end: '13:00' },
      ]),
    ).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '15:00' },
      { start: '16:00', end: '18:00' },
    ])
  })

  it('scheduleToRanges emits no leading range when a break starts at open time', () => {
    expect(scheduleToRanges('09:00', '18:00', [{ start: '09:00', end: '10:00' }])).toEqual([
      { start: '10:00', end: '18:00' },
    ])
  })

  it('scheduleToRanges emits no trailing range when a break ends at close time', () => {
    expect(scheduleToRanges('09:00', '18:00', [{ start: '17:00', end: '18:00' }])).toEqual([
      { start: '09:00', end: '17:00' },
    ])
  })

  it('scheduleToRanges drops zero-length / inverted breaks', () => {
    expect(scheduleToRanges('09:00', '18:00', [{ start: '14:00', end: '14:00' }])).toEqual([
      { start: '09:00', end: '18:00' },
    ])
  })

  it('round-trips ranges → schedule → ranges', () => {
    const ranges: TimeRange[] = [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]
    const schedule = rangesToSchedule(true, ranges)
    expect(scheduleToRanges(schedule.openTime, schedule.closeTime, schedule.breaks)).toEqual(ranges)
  })
})

describe('dayScheduleIssue (path coverage of all four outcomes)', () => {
  it('returns null for a valid day with in-bounds, non-overlapping breaks', () => {
    expect(dayScheduleIssue('09:00', '18:00', [{ start: '13:00', end: '14:00' }])).toBeNull()
  })
  it('returns "endBeforeStart" when close is not after open', () => {
    expect(dayScheduleIssue('18:00', '09:00', [])).toBe('endBeforeStart')
  })
  it('returns "endBeforeStart" when a break end is not after its start', () => {
    expect(dayScheduleIssue('09:00', '18:00', [{ start: '14:00', end: '14:00' }])).toBe('endBeforeStart')
  })
  it('returns "breakOutsideHours" when a break falls outside the window', () => {
    expect(dayScheduleIssue('09:00', '18:00', [{ start: '08:00', end: '10:00' }])).toBe('breakOutsideHours')
  })
  it('returns "rangeOverlap" when two in-bounds breaks overlap', () => {
    expect(
      dayScheduleIssue('09:00', '18:00', [
        { start: '12:00', end: '14:00' },
        { start: '13:00', end: '15:00' },
      ]),
    ).toBe('rangeOverlap')
  })
})
