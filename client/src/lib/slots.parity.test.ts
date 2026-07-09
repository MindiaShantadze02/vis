import { describe, expect, it } from 'vitest'
import { computeAvailableSlotsWithCapacity as clientCompute, businessDayWindow as clientWindow, businessDayKey as clientDayKey } from './slots'
import type { SlotParams as ClientParams } from './slots'
import {
  computeAvailableSlotsWithCapacity as denoCompute,
  businessDayWindow as denoWindow,
  businessDayKey as denoDayKey,
} from '../../../supabase/functions/_shared/slots'
import type { SlotParams as DenoParams } from '../../../supabase/functions/_shared/slots'

/**
 * Behavioural sync guard for the two slot engines. The public REST API runs a
 * Deno port of this directory's slots.ts (supabase/functions/_shared/slots.ts,
 * see the KEEP IN SYNC headers in both files); the API's /v1/slots must return
 * exactly what the booking page shows. This suite feeds identical scenarios to
 * both implementations and requires identical output — if a slot-rule change
 * lands in only one copy, this is the test that fails.
 *
 * The only intended interface difference: the client takes `date: Date`
 * (deriving the day via date-fns format), the Deno port takes
 * `dateKey: "yyyy-MM-dd"`.
 */

const DATE_KEY = '2026-07-15' // a Wednesday
const NOW = new Date('2026-07-01T00:00:00Z') // well before the day: no past-slot cutoff

const week = (cfg: Record<string, { open: boolean; ranges: { start: string; end: string }[] }>) => ({
  monday: { open: false, ranges: [] },
  tuesday: { open: false, ranges: [] },
  wednesday: { open: false, ranges: [] },
  thursday: { open: false, ranges: [] },
  friday: { open: false, ranges: [] },
  saturday: { open: false, ranges: [] },
  sunday: { open: false, ranges: [] },
  ...cfg,
})

const appt = (isoStart: string, minutes: number, serviceId = 'svc-1', staffId: string | null = null) => ({
  scheduled_at: isoStart,
  duration_minutes: minutes,
  service_id: serviceId,
  staff_id: staffId,
})

/** Run both engines on the same scenario and assert identical output. */
function expectParity(shared: Omit<ClientParams, 'date'> & { now: Date }) {
  const clientOut = clientCompute({ ...shared, date: new Date(`${DATE_KEY}T00:00:00`) })
  const denoOut = denoCompute({ ...(shared as Omit<DenoParams, 'dateKey'>), dateKey: DATE_KEY })
  expect(denoOut).toEqual(clientOut)
  return clientOut
}

const base = {
  template: week({ wednesday: { open: true, ranges: [{ start: '09:00', end: '12:00' }] } }),
  override: null,
  existing: [],
  serviceId: 'svc-1',
  durationMinutes: 30,
  maxPerSlot: 1,
  assignedStaff: [] as { id: string }[],
  selectedStaffId: null,
  now: NOW,
}

describe('client slots.ts ↔ Deno _shared/slots.ts parity', () => {
  it('helpers agree (day key + day window)', () => {
    for (const iso of ['2026-07-04T22:00:00Z', '2026-07-05T19:59:59.999Z', '2026-07-05T20:00:00Z']) {
      expect(denoDayKey(iso)).toBe(clientDayKey(iso))
    }
    expect(denoWindow(DATE_KEY)).toEqual(clientWindow(DATE_KEY))
  })

  it('open day, no bookings', () => {
    const out = expectParity(base)
    expect(out.map(s => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
  })

  it('no template / closed day / closed override all yield nothing', () => {
    expect(expectParity({ ...base, template: null })).toEqual([])
    expect(expectParity({ ...base, template: week({}) })).toEqual([])
    expect(expectParity({ ...base, override: { is_closed: true, ranges: null } })).toEqual([])
  })

  it('an override replaces the weekday ranges', () => {
    const out = expectParity({
      ...base,
      override: { is_closed: false, ranges: [{ start: '14:00', end: '15:00' }] },
    })
    expect(out.map(s => s.time)).toEqual(['14:00', '14:30'])
  })

  it('existing bookings consume per-service capacity', () => {
    // 10:00–10:30 Tbilisi = 06:00Z; same service blocks, other service does not
    const out = expectParity({
      ...base,
      existing: [
        appt(`${DATE_KEY}T06:00:00.000Z`, 30),
        appt(`${DATE_KEY}T05:00:00.000Z`, 30, 'other-svc'),
      ],
    })
    expect(out.map(s => s.time)).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30'])
  })

  it('maxPerSlot > 1 reports remaining capacity', () => {
    const out = expectParity({
      ...base,
      maxPerSlot: 2,
      existing: [appt(`${DATE_KEY}T05:00:00.000Z`, 30)], // 09:00 half-full
    })
    expect(out.find(s => s.time === '09:00')).toEqual({ time: '09:00', remaining: 1, total: 2 })
    expect(out.find(s => s.time === '09:30')).toEqual({ time: '09:30', remaining: 2, total: 2 })
  })

  it('"any available" staff: busy members reduce remaining across services', () => {
    const out = expectParity({
      ...base,
      maxPerSlot: 5,
      assignedStaff: [{ id: 'm1' }, { id: 'm2' }],
      existing: [appt(`${DATE_KEY}T05:00:00.000Z`, 30, 'other-svc', 'm1')], // m1 busy 09:00
    })
    expect(out.find(s => s.time === '09:00')).toEqual({ time: '09:00', remaining: 1, total: 2 })
  })

  it('a specific busy member drops the slot entirely', () => {
    const out = expectParity({
      ...base,
      assignedStaff: [{ id: 'm1' }, { id: 'm2' }],
      selectedStaffId: 'm1',
      existing: [appt(`${DATE_KEY}T05:00:00.000Z`, 30, 'other-svc', 'm1')],
    })
    expect(out.map(s => s.time)).not.toContain('09:00')
    expect(out.find(s => s.time === '09:30')).toEqual({ time: '09:30', remaining: 1, total: 1 })
  })

  it('past slots are cut off relative to `now`', () => {
    // 10:05 Tbilisi = 06:05Z → 09:00–10:00 slots are in the past, 10:30 is next
    const out = expectParity({ ...base, now: new Date(`${DATE_KEY}T06:05:00.000Z`) })
    expect(out.map(s => s.time)).toEqual(['10:30', '11:00', '11:30'])
  })

  it('a duration that does not fit before closing is not offered', () => {
    const out = expectParity({ ...base, durationMinutes: 50 })
    // 09:00 + n·50min ≤ 12:00 → 09:00, 09:50, 10:40 fit; 11:30 would end 12:20
    expect(out.map(s => s.time)).toEqual(['09:00', '09:50', '10:40'])
  })
})
