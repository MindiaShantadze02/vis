/**
 * Restaurant table-availability computation. Pure functions, mirroring the
 * appointment `slots.ts` style: callers pass the working-hours template, the
 * date's override, the org's tables, and existing reservations.
 *
 * Unlike appointments (per-service concurrency), restaurant availability is
 * party-size → table-capacity matching over a turn window: a time is bookable
 * if at least one active table big enough for the party is free for the whole
 * turn. The smallest such free table is returned so the booking can claim it.
 */
import { format, isBefore } from 'date-fns'
import { getDayKey } from './slots'
import type { WeekTemplate, SlotOverride } from './slots'

export interface RestaurantTable {
  id: string
  capacity: number
}

export interface ReservationRow {
  reserved_at: string
  turn_minutes: number
  table_id: string | null
}

export interface ReservationSlotParams {
  date: Date
  template: WeekTemplate | null
  override: SlotOverride | null
  tables: RestaurantTable[]
  existing: ReservationRow[]
  partySize: number
  /** How long a seating holds a table, minutes. */
  turnMinutes: number
  /** Granularity between candidate start times, minutes. */
  slotMinutes: number
  /** Injectable clock for testing; defaults to now. Past slots are excluded. */
  now?: Date
}

export interface ReservationSlot {
  /** Start time, "HH:mm". */
  time: string
  /** The smallest fitting table free at this time — claim it on booking. */
  tableId: string
  /** How many fitting tables are still free (for scarcity cues). */
  remaining: number
}

/**
 * Free seating times for the given date/party size. Only times with at least
 * one fitting free table are returned, each carrying the smallest such table id.
 */
export function computeReservationSlots(p: ReservationSlotParams): ReservationSlot[] {
  const { date, template, override, tables, partySize, turnMinutes, slotMinutes } = p
  if (!template) return []
  if (override?.is_closed) return []

  const cfg = override?.ranges
    ? { open: true, ranges: override.ranges }
    : template[getDayKey(date)]
  if (!cfg?.open) return []

  // Tables big enough for the party, smallest first so we seat efficiently.
  const fitting = tables
    .filter(tbl => tbl.capacity >= partySize)
    .sort((a, b) => a.capacity - b.capacity)
  if (fitting.length === 0) return []

  const now = p.now ?? new Date()
  const out: ReservationSlot[] = []

  for (const range of cfg.ranges) {
    const [sh, sm] = range.start.split(':').map(Number)
    const [eh, em] = range.end.split(':').map(Number)
    const cur = new Date(date)
    cur.setHours(sh, sm, 0, 0)
    const end = new Date(date)
    end.setHours(eh, em, 0, 0)

    while (cur < end) {
      // A seating must finish (turn over) by close.
      const slotEnd = new Date(cur.getTime() + turnMinutes * 60000)
      if (slotEnd <= end && !isBefore(cur, now)) {
        const freeTables = fitting.filter(tbl => isTableFree(tbl.id, cur, slotEnd, p.existing))
        if (freeTables.length > 0) {
          out.push({ time: format(cur, 'HH:mm'), tableId: freeTables[0].id, remaining: freeTables.length })
        }
      }
      cur.setTime(cur.getTime() + slotMinutes * 60000)
    }
  }

  return out
}

/** A table is free across [start,end) if no reservation on it overlaps that window. */
function isTableFree(tableId: string, start: Date, end: Date, existing: ReservationRow[]): boolean {
  for (const r of existing) {
    if (r.table_id !== tableId) continue
    const rStart = new Date(r.reserved_at).getTime()
    const rEnd = rStart + r.turn_minutes * 60000
    if (start.getTime() < rEnd && end.getTime() > rStart) return false
  }
  return true
}
