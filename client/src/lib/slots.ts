/**
 * Shared availability-slot computation for the public booking flow
 * (Step2DateTimeSelect). All functions here are pure — callers pass in the
 * working-hours template, the date's override, and the existing appointments.
 *
 * This is the single implementation of the slot rules: the Deno port that the
 * public REST API ran (supabase/functions/_shared/slots.ts) went with the API
 * itself, and with it the sync guard in slots.parity.test.ts.
 */
import { format, isBefore } from 'date-fns'

/**
 * All wall-clock times in the booking domain (working-hours templates,
 * overrides, slot labels, scheduled_at) mean **business time — Georgia**.
 * Georgia is permanently UTC+4 (no DST since 2005), so a fixed offset is
 * exact. Anchoring slot instants to this offset — instead of the viewer's
 * timezone — means a customer browsing from abroad sees and books the same
 * wall-clock slots the business actually operates.
 */
export const BUSINESS_UTC_OFFSET = '+04:00'
const OFFSET_MS = 4 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000

/** The yyyy-MM-dd calendar date of an instant, in business (Tbilisi) time. */
export function businessDayKey(at: string | Date): string {
  const t = typeof at === 'string' ? new Date(at).getTime() : at.getTime()
  return new Date(t + OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * "Today" in business time, as a viewer-local midnight Date — so existing
 * calendar math (addDays / isBefore / format) keeps working on it unchanged.
 */
export function businessToday(now: Date = new Date()): Date {
  return new Date(businessDayKey(now) + 'T00:00:00')
}

/**
 * UTC ISO bounds of one business-time calendar day, for scheduled_at range
 * queries. Replaces the old `dateKey + 'T00:00:00.000Z'` windows, which
 * treated the local day as a UTC day and so missed appointments between
 * 00:00 and 03:59 Tbilisi time.
 */
export function businessDayWindow(dateKey: string): { from: string; to: string } {
  const start = Date.parse(`${dateKey}T00:00:00${BUSINESS_UTC_OFFSET}`)
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + DAY_MS - 1).toISOString(),
  }
}

/**
 * A Date whose *viewer-local* fields mirror the instant's Tbilisi wall clock,
 * so date-fns `format()` renders business time regardless of where the
 * customer's browser is. Display-only — never store or compare it.
 */
export function toBusinessWallClock(at: string | Date): Date {
  const t = typeof at === 'string' ? new Date(at).getTime() : at.getTime()
  // Shift to UTC+4, then re-parse the wall-clock digits as viewer-local.
  return new Date(new Date(t + OFFSET_MS).toISOString().slice(0, -1))
}

export interface SlotApptRow {
  scheduled_at: string
  duration_minutes: number
  service_id: string
  staff_id: string | null
}

export interface DayConfig {
  open: boolean
  ranges: { start: string; end: string }[]
}

/** Weekly template keyed by lower-case weekday name ('monday' … 'sunday'). */
export type WeekTemplate = Record<string, DayConfig>

export interface SlotOverride {
  is_closed: boolean
  ranges: { start: string; end: string }[] | null
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Weekday key for a date, matching the working_hours_template columns. */
export function getDayKey(d: Date): string {
  return DAY_KEYS[d.getDay()]
}

export interface SlotParams {
  date: Date
  template: WeekTemplate | null
  override: SlotOverride | null
  existing: SlotApptRow[]
  serviceId: string
  durationMinutes: number
  maxPerSlot: number
  assignedStaff: { id: string }[]
  /** Specific member id, or null for "any available" (capacity-only when no staff). */
  selectedStaffId: string | null
  /** Injectable clock for testing; defaults to now. Past slots are excluded. */
  now?: Date
}

/** A free slot plus how much capacity is left in it (for scarcity cues). */
export interface SlotCapacity {
  /** Start time, "HH:mm". */
  time: string
  /** Bookings that can still be taken in this slot (>= 1 for returned slots). */
  remaining: number
  /** The slot's full capacity when empty — drives whether "N left" is shown. */
  total: number
}

/**
 * Free start times ("HH:mm") for the given date/service, honouring the day's
 * working ranges (or a same-day override), per-service capacity, and per-person
 * availability. Slots in the past are dropped.
 */
export function computeAvailableSlots(p: SlotParams): string[] {
  return computeAvailableSlotsWithCapacity(p).map(s => s.time)
}

/**
 * Like computeAvailableSlots, but also reports each slot's remaining and total
 * capacity so the UI can surface scarcity ("2 left"). Only slots with
 * remaining > 0 are returned, so `.map(s => s.time)` is exactly the available list.
 */
export function computeAvailableSlotsWithCapacity(p: SlotParams): SlotCapacity[] {
  const { date, template, override, durationMinutes } = p
  if (!template) return []
  if (override?.is_closed) return []

  const cfg = override?.ranges
    ? { open: true, ranges: override.ranges }
    : template[getDayKey(date)]

  if (!cfg?.open) return []

  const now = p.now ?? new Date()
  const generated: SlotCapacity[] = []

  // Anchor the day at business-time midnight so slot instants (and therefore
  // overlap checks and the past-slot cutoff) don't depend on the viewer's
  // timezone. `date` is a calendar day; format() extracts it zone-free.
  const dayStartMs = Date.parse(`${format(date, 'yyyy-MM-dd')}T00:00:00${BUSINESS_UTC_OFFSET}`)

  for (const range of cfg.ranges) {
    const [sh, sm] = range.start.split(':').map(Number)
    const [eh, em] = range.end.split(':').map(Number)
    let curMin = sh * 60 + sm
    const endMin = eh * 60 + em

    while (curMin + durationMinutes <= endMin) {
      const cur = new Date(dayStartMs + curMin * 60000)
      const slotEnd = new Date(cur.getTime() + durationMinutes * 60000)

      if (!isBefore(cur, now)) {
        const cap = slotCapacity(cur, slotEnd, p)
        if (cap.remaining > 0) {
          const label = `${String(Math.floor(curMin / 60)).padStart(2, '0')}:${String(curMin % 60).padStart(2, '0')}`
          generated.push({ time: label, ...cap })
        }
      }

      curMin += durationMinutes
    }
  }

  return generated
}

/**
 * Remaining + total capacity for a slot, combining per-service capacity
 * (max_per_slot) with per-person availability. remaining === 0 means the slot
 * is not bookable (the old isSlotAvailable === false case).
 */
function slotCapacity(cur: Date, slotEnd: Date, p: SlotParams): { remaining: number; total: number } {
  const { existing, serviceId, maxPerSlot, assignedStaff, selectedStaffId } = p

  const overlapping = existing.filter(a => {
    const aStart = new Date(a.scheduled_at).getTime()
    const aEnd = aStart + a.duration_minutes * 60000
    return cur.getTime() < aEnd && slotEnd.getTime() > aStart
  })

  // Per-service concurrency cap.
  const serviceCount = overlapping.filter(a => a.service_id === serviceId).length
  const capRemaining = maxPerSlot - serviceCount

  // No assigned staff → capacity is the only constraint.
  if (assignedStaff.length === 0) {
    return { remaining: Math.max(0, capRemaining), total: maxPerSlot }
  }

  // A member is busy if they have ANY overlapping appointment (across services).
  const busyIds = new Set(overlapping.map(a => a.staff_id).filter(Boolean))
  const freeMembers = assignedStaff.filter(m => !busyIds.has(m.id))

  // "Any available" — bounded by both the capacity cap and free-member count.
  if (selectedStaffId === null) {
    return {
      remaining: Math.max(0, Math.min(capRemaining, freeMembers.length)),
      total: Math.min(maxPerSlot, assignedStaff.length),
    }
  }

  // A specific member — it's simply free or not (capacity permitting).
  const memberFree = freeMembers.some(m => m.id === selectedStaffId)
  return { remaining: capRemaining > 0 && memberFree ? 1 : 0, total: 1 }
}
