import { supabase } from '@/lib/supabase'

/**
 * Booking-page view counting.
 *
 * One visitor counts once per business per day. The de-duplication happens
 * HERE, in the browser — localStorage remembers the last day this device
 * counted each slug — so the server only ever receives "+1" and never stores a
 * visitor id, IP or session token. That keeps the whole feature clear of the
 * consent/retention rules the customer tables live under: there is nothing
 * stored that could be attributed to a person.
 *
 * The cost of that choice is that the count is defeatable (clear storage, or a
 * private window, and you count again). These are an interest signal for the
 * business, not an audited figure — nothing bills off them.
 *
 * Never throws and never blocks the booking flow: a failed count must not stop
 * someone making an appointment.
 */
const KEY_PREFIX = 'vis-viewed:'

/**
 * Slugs with a count already in flight this page load.
 *
 * Needed because the localStorage stamp alone does not close the window between
 * two callers that start before either has finished. React StrictMode runs
 * every effect twice in development, so the booking page reliably fired two
 * counts for a single visit; the same race exists in production for any
 * double-mount. This is checked and set synchronously, so the second caller
 * always loses.
 */
const inFlight = new Set<string>()

/** Local calendar day in Tbilisi, matching how the server dates the counter. */
function businessDayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tbilisi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function readStamp(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function writeStamp(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private mode — best effort */ }
}

function clearStamp(key: string): void {
  try { localStorage.removeItem(key) } catch { /* best effort */ }
}

export async function recordBookingPageView(slug: string): Promise<void> {
  if (!slug) return
  const key = `${KEY_PREFIX}${slug}`
  const today = businessDayKey()

  // Both guards are checked BEFORE any await, so two callers in the same tick
  // cannot both get through.
  if (inFlight.has(slug)) return
  if (readStamp(key) === today) return

  inFlight.add(slug)
  // Claim the day up front rather than after the request. Writing it afterwards
  // left the whole round trip unguarded, which is exactly how one visit became
  // two. If the call then fails we release the claim below, so a real visitor
  // is not lost — the failure mode is a retry, not a silent double count.
  writeStamp(key, today)

  try {
    const { error } = await supabase.rpc('record_booking_page_view', { p_slug: slug })
    if (error) clearStamp(key)
  } catch {
    clearStamp(key)
  } finally {
    inFlight.delete(slug)
  }
}

/** Test-only: drop the in-flight guard so a spec can simulate a fresh load. */
export function __resetViewGuardForTests(): void {
  inFlight.clear()
}
