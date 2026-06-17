/**
 * Shared availability-slot computation used by both the public booking flow
 * (Step2DateTimeSelect) and the admin manual-entry dialog (AddAppointmentDialog),
 * so the two stay in sync. All functions here are pure — callers pass in the
 * working-hours template, the date's override, and the existing appointments.
 */
import { format, isBefore } from 'date-fns'

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

/**
 * Free start times ("HH:mm") for the given date/service, honouring the day's
 * working ranges (or a same-day override), per-service capacity, and per-person
 * availability. Slots in the past are dropped.
 */
export function computeAvailableSlots(p: SlotParams): string[] {
  const { date, template, override, durationMinutes } = p
  if (!template) return []
  if (override?.is_closed) return []

  const cfg = override?.ranges
    ? { open: true, ranges: override.ranges }
    : template[getDayKey(date)]

  if (!cfg?.open) return []

  const now = p.now ?? new Date()
  const generated: string[] = []

  for (const range of cfg.ranges) {
    const [sh, sm] = range.start.split(':').map(Number)
    const [eh, em] = range.end.split(':').map(Number)
    let cur = new Date(date)
    cur.setHours(sh, sm, 0, 0)
    const end = new Date(date)
    end.setHours(eh, em, 0, 0)

    while (cur < end) {
      const slotEnd = new Date(cur.getTime() + durationMinutes * 60000)
      if (slotEnd > end) break

      if (!isBefore(cur, now) && isSlotAvailable(cur, slotEnd, p)) {
        generated.push(format(cur, 'HH:mm'))
      }

      cur = new Date(cur.getTime() + durationMinutes * 60000)
    }
  }

  return generated
}

/** Combines per-service capacity (max_per_slot) with per-person availability. */
function isSlotAvailable(cur: Date, slotEnd: Date, p: SlotParams): boolean {
  const { existing, serviceId, maxPerSlot, assignedStaff, selectedStaffId } = p

  const overlapping = existing.filter(a => {
    const aStart = new Date(a.scheduled_at).getTime()
    const aEnd = aStart + a.duration_minutes * 60000
    return cur.getTime() < aEnd && slotEnd.getTime() > aStart
  })

  // Per-service concurrency cap.
  const serviceCount = overlapping.filter(a => a.service_id === serviceId).length
  if (serviceCount >= maxPerSlot) return false

  // No assigned staff → capacity is the only constraint.
  if (assignedStaff.length === 0) return true

  // A member is busy if they have ANY overlapping appointment (across services).
  const busyIds = new Set(overlapping.map(a => a.staff_id).filter(Boolean))
  const freeMembers = assignedStaff.filter(m => !busyIds.has(m.id))

  if (selectedStaffId === null) return freeMembers.length >= 1
  return freeMembers.some(m => m.id === selectedStaffId)
}
