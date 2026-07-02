/**
 * Hotel room availability over a date range. Pure functions, mirroring the
 * restaurant `restaurantSlots.ts` style.
 *
 * Hotels book a multi-night range (check_in .. check_out). A room TYPE has a
 * fixed number of identical rooms (`totalRooms`); a stay occupies one room of
 * its type for every night in its range. A type is available for a requested
 * range if, on EVERY night of that range, fewer than `totalRooms` are already
 * occupied — i.e. the busiest night still has a free room.
 */
import { differenceInCalendarDays, addDays } from 'date-fns'

export interface HotelRoomType {
  id: string
  name: string
  /** Max guests one room of this type sleeps. */
  capacity: number
  /** How many identical rooms of this type exist. */
  totalRooms: number
  nightlyPrice: number
}

export interface StayRow {
  room_type_id: string | null
  check_in: string  // yyyy-MM-dd
  check_out: string // yyyy-MM-dd
}

export interface RoomAvailabilityParams {
  checkIn: Date
  checkOut: Date
  guests: number
  roomTypes: HotelRoomType[]
  existing: StayRow[]
}

export interface RoomOption {
  id: string
  name: string
  capacity: number
  nights: number
  nightlyPrice: number
  total: number
  /** Rooms of this type still free across the whole range (min over nights). */
  remaining: number
  /** Optional marketing blurb (from resources.attrs.description). */
  description?: string | null
}

const dayMs = 24 * 60 * 60 * 1000

/** Midnight-normalised ms for a yyyy-MM-dd or Date. */
function dayStart(d: string | Date): number {
  const dt = typeof d === 'string' ? new Date(`${d}T00:00:00`) : new Date(d)
  dt.setHours(0, 0, 0, 0)
  return dt.getTime()
}

/**
 * Available room types for the requested range + party, each with the computed
 * nightly price, number of nights, and total. Only types that fit the party and
 * have a free room on every night are returned.
 */
export function computeRoomAvailability(p: RoomAvailabilityParams): RoomOption[] {
  const { checkIn, checkOut, guests, roomTypes, existing } = p
  const nights = differenceInCalendarDays(checkOut, checkIn)
  if (nights <= 0) return []

  // The nights (as midnight ms) this stay would occupy: check_in .. check_out-1.
  const reqNights: number[] = []
  for (let i = 0; i < nights; i++) reqNights.push(dayStart(addDays(checkIn, i)))

  const out: RoomOption[] = []

  for (const rt of roomTypes) {
    if (rt.capacity < guests || rt.totalRooms <= 0) continue

    // Busiest requested night for this room type.
    let maxOccupied = 0
    for (const night of reqNights) {
      let occupied = 0
      for (const s of existing) {
        if (s.room_type_id !== rt.id) continue
        // A stay occupies night `night` if check_in <= night < check_out.
        if (dayStart(s.check_in) <= night && night < dayStart(s.check_out)) occupied++
      }
      if (occupied > maxOccupied) maxOccupied = occupied
    }

    const remaining = rt.totalRooms - maxOccupied
    if (remaining > 0) {
      out.push({
        id: rt.id,
        name: rt.name,
        capacity: rt.capacity,
        nights,
        nightlyPrice: rt.nightlyPrice,
        total: nights * rt.nightlyPrice,
        remaining,
      })
    }
  }

  return out
}

/** Nights between two dates (0 if invalid order). */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(0, Math.round((dayStart(checkOut) - dayStart(checkIn)) / dayMs))
}
