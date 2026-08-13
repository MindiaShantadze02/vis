import type { BookingState } from './BookingLayout'

// In-progress booking is kept in sessionStorage (per tab, per business) so an
// accidental refresh — or returning from the payment gateway redirect — restores
// the customer's place instead of dumping them back at step 1.
//
// Lives in its own module rather than in BookingLayout: the confirmation page
// needs to rewind the draft, and both are separately lazy()-loaded routes —
// importing BookingLayout there would drag the whole wizard into the
// confirmation chunk.
export const storageKey = (slug: string) => `vis_booking_${slug}`

export interface PersistedBooking { booking: BookingState; step: number }

export function loadPersisted(slug: string | undefined): PersistedBooking | null {
  if (!slug) return null
  try {
    const raw = sessionStorage.getItem(storageKey(slug))
    return raw ? (JSON.parse(raw) as PersistedBooking) : null
  } catch {
    return null
  }
}

/**
 * Rewind a completed booking's draft so "book another" can't resubmit the slot
 * the customer just took. Their details, service and day survive; the time is
 * cleared and the flow rewinds to the date/time step, where Step 2 refetches
 * availability on mount (it holds no cache) and shows the slot as taken.
 *
 * The online-payment path never reaches BookingLayout's onDone (Step 3 hands off
 * to the gateway and the webhook creates the appointment), so without this the
 * draft still points at the booked slot and the flow resumes on the details step
 * — where submitting fails with 'slot_taken'.
 *
 * No-op when no draft exists (e.g. the no-charge path clears it in onDone).
 */
export function prepareRebookDraft(slug: string | undefined): void {
  const p = loadPersisted(slug)
  if (!slug || !p) return
  try {
    sessionStorage.setItem(
      storageKey(slug),
      JSON.stringify({ booking: { ...p.booking, time: '' }, step: 1 }),
    )
  } catch {
    /* ignore quota / serialization errors — persistence is best-effort */
  }
}
