import { test, expect } from '@playwright/test'
import {
  FIELD_LIMITS,
  MAX_PRICE,
  dayScheduleIssue,
  imageFileError,
  isNonNegativeNumber,
  isValidGeorgianPhone,
  isValidPersonName,
  isValidUrl,
  type TimeRange,
} from '../../src/lib/validation'
import authLogin from '../data/auth-login.json' with { type: 'json' }
import bookingCustomer from '../data/booking-customer.json' with { type: 'json' }
import profile from '../data/profile.json' with { type: 'json' }
import services from '../data/services.json' with { type: 'json' }
import team from '../data/team.json' with { type: 'json' }
import workingHours from '../data/working-hours.json' with { type: 'json' }

/**
 * Boundary-sync guard: the JSON data files encode the app's validation
 * boundaries as literals. If a limit changes in src/lib/validation.ts (or a
 * validator's behaviour shifts), this spec fails loudly instead of letting the
 * data-driven suite keep testing stale numbers. Pure logic — no browser use.
 */

type Invariant = { fn: string; input: unknown; expect: unknown }

const VALIDATORS: Record<string, (...args: never[]) => unknown> = {
  isValidGeorgianPhone,
  isValidPersonName,
  isValidUrl,
  isNonNegativeNumber,
  dayScheduleIssue: dayScheduleIssue as (...args: never[]) => unknown,
}

const FILES: { name: string; invariants: Invariant[] }[] = [
  { name: 'auth-login.json', invariants: authLogin.invariants as Invariant[] },
  { name: 'booking-customer.json', invariants: bookingCustomer.invariants as Invariant[] },
  { name: 'services.json', invariants: services.invariants as Invariant[] },
  { name: 'team.json', invariants: team.invariants as Invariant[] },
  { name: 'working-hours.json', invariants: workingHours.invariants as Invariant[] },
]

test.describe('Data-driven — boundary-sync guard', () => {
  test('data-file constants match the app limits', async () => {
    expect(services.meta.maxPrice).toBe(MAX_PRICE)
    expect(bookingCustomer.meta.notesMax).toBe(FIELD_LIMITS.notes)
    // 2 MB logo ceiling (MAX_LOGO_BYTES is module-private; the behavioural
    // check below pins the exact boundary).
    expect(profile.meta.maxLogoBytes).toBe(2 * 1024 * 1024)
  })

  test('validator invariants recorded in the data files still hold', async () => {
    for (const file of FILES) {
      for (const inv of file.invariants) {
        await test.step(`${file.name}: ${inv.fn}(${JSON.stringify(inv.input)})`, async () => {
          const fn = VALIDATORS[inv.fn]
          expect(fn, `unknown validator ${inv.fn}`).toBeDefined()
          const args = (Array.isArray(inv.input) ? inv.input : [inv.input]) as never[]
          expect(fn(...args)).toStrictEqual(inv.expect)
        })
      }
    }
  })

  test('logo boundary (2 MB) behaves exactly at, above, and off the image partition', async () => {
    for (const c of profile.imageInvariants) {
      await test.step(c.id, async () => {
        const file = new File([new Uint8Array(c.bytes)], 'probe', { type: c.mime })
        expect(imageFileError(file)).toBe(c.expect)
      })
    }
  })

  test('working-hours decision rows agree with dayScheduleIssue', async () => {
    for (const c of workingHours.scheduleCases) {
      await test.step(c.id, async () => {
        const breaks: TimeRange[] = c.breaks.map(([start, end]) => ({ start, end }))
        expect(dayScheduleIssue(c.open, c.close, breaks)).toBe(c.issue)
      })
    }
  })
})
