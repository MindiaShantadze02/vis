import { describe, expect, it } from 'vitest'
import {
  businessDayKey, businessDayWindow, toBusinessWallClock, getDayKey,
  computeAvailableSlots, computeAvailableSlotsWithCapacity,
} from './slots'
import type { SlotParams } from './slots'

/**
 * Timezone correctness of the booking-domain helpers. Everything here is
 * asserted against instants (UTC ISO strings) or business wall-clock fields,
 * so the suite passes identically in any TZ the test runner happens to use —
 * that TZ-independence is exactly the property under test. Georgia is a fixed
 * UTC+4 (no DST), so boundaries are exact.
 */

describe('businessDayKey', () => {
  it('maps a UTC instant to its Tbilisi calendar date', () => {
    // 22:00Z = 02:00 next day in Tbilisi
    expect(businessDayKey('2026-07-04T22:00:00+00:00')).toBe('2026-07-05')
  })

  it('BVA: the Tbilisi midnight boundary is 20:00Z', () => {
    expect(businessDayKey('2026-07-05T19:59:59.999Z')).toBe('2026-07-05')
    expect(businessDayKey('2026-07-05T20:00:00.000Z')).toBe('2026-07-06')
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(businessDayKey(new Date('2026-07-05T10:00:00Z'))).toBe('2026-07-05')
  })
})

describe('businessDayWindow', () => {
  it('spans exactly the Tbilisi day in UTC', () => {
    expect(businessDayWindow('2026-07-05')).toEqual({
      from: '2026-07-04T20:00:00.000Z',
      to: '2026-07-05T19:59:59.999Z',
    })
  })

  it('round-trips with businessDayKey at both edges', () => {
    const { from, to } = businessDayWindow('2026-07-05')
    expect(businessDayKey(from)).toBe('2026-07-05')
    expect(businessDayKey(to)).toBe('2026-07-05')
  })
})

describe('toBusinessWallClock', () => {
  it('exposes Tbilisi wall-clock fields to local formatters', () => {
    // 09:30Z = 13:30 Tbilisi
    const d = toBusinessWallClock('2026-07-05T09:30:00Z')
    expect(d.getHours()).toBe(13)
    expect(d.getMinutes()).toBe(30)
    expect(d.getDate()).toBe(5)
  })

  it('rolls the calendar date forward past Tbilisi midnight', () => {
    // 21:00Z on the 5th = 01:00 on the 6th in Tbilisi
    const d = toBusinessWallClock('2026-07-05T21:00:00Z')
    expect(d.getHours()).toBe(1)
    expect(d.getDate()).toBe(6)
  })
})

// ── Slot generation is anchored to business time ─────────────────

// A calendar day for slot tests; the weekday key is derived, not hardcoded,
// so the template always matches whatever weekday this date is.
const DATE = new Date('2026-07-06T00:00:00')
const DATE_KEY = getDayKey(DATE)
// Far in the past — no slot ever gets dropped by the past-cutoff by accident.
const LONG_AGO = new Date('2000-01-01T00:00:00Z')

function baseParams(over: Partial<SlotParams> = {}): SlotParams {
  return {
    date: DATE,
    template: { [DATE_KEY]: { open: true, ranges: [{ start: '10:00', end: '12:00' }] } },
    override: null,
    existing: [],
    serviceId: 'svc-1',
    durationMinutes: 30,
    maxPerSlot: 1,
    assignedStaff: [],
    selectedStaffId: null,
    now: LONG_AGO,
    ...over,
  }
}

describe('computeAvailableSlots (business-time anchoring)', () => {
  it('walks the working range in wall-clock labels', () => {
    expect(computeAvailableSlots(baseParams())).toEqual(['10:00', '10:30', '11:00', '11:30'])
  })

  it('BVA: a slot must fit fully inside the range (walk steps by duration)', () => {
    // 10:00-11:30 window, 60-min service → 10:00 fits; the next step, 11:00,
    // would spill past 11:30 and is dropped.
    expect(computeAvailableSlots(baseParams({
      template: { [DATE_KEY]: { open: true, ranges: [{ start: '10:00', end: '11:30' }] } },
      durationMinutes: 60,
    }))).toEqual(['10:00'])
  })

  it('applies the past-cutoff in business time, not the runner TZ', () => {
    // "now" = 06:30Z = 10:30 Tbilisi → 10:00 is past, 10:30 onward remain.
    expect(computeAvailableSlots(baseParams({
      now: new Date('2026-07-06T06:30:00Z'),
    }))).toEqual(['10:30', '11:00', '11:30'])
  })

  it('blocks a slot against a UTC-stored appointment at the same business time', () => {
    // 06:00Z = 10:00 Tbilisi, 30 min → exactly the first slot.
    expect(computeAvailableSlots(baseParams({
      existing: [{
        scheduled_at: '2026-07-06T06:00:00+00:00',
        duration_minutes: 30, service_id: 'svc-1', staff_id: null,
      }],
    }))).toEqual(['10:30', '11:00', '11:30'])
  })
})

describe('computeAvailableSlotsWithCapacity', () => {
  it('reports remaining/total per slot', () => {
    const slots = computeAvailableSlotsWithCapacity(baseParams({
      maxPerSlot: 3,
      existing: [{
        scheduled_at: '2026-07-06T06:00:00+00:00', // 10:00 Tbilisi
        duration_minutes: 30, service_id: 'svc-1', staff_id: null,
      }],
    }))
    expect(slots[0]).toEqual({ time: '10:00', remaining: 2, total: 3 })
    expect(slots[1]).toEqual({ time: '10:30', remaining: 3, total: 3 })
  })
})
