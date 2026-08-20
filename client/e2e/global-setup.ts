import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Frees the seed org's calendar before a run.
 *
 * Booking specs create real appointments against one shared hosted backend and
 * only some of them self-clean, so the seed calendar silently fills up. Once the
 * near days are saturated the booking flow has no selectable day and ~13 specs
 * across booking / deposit / refund / approval / meeting-link all fail at the
 * day-strip — for reasons that have nothing to do with the change under test.
 * That happened repeatedly on 2026-08-19/20 and cost more time than the bugs did.
 *
 * Cancelling (not deleting) is the right tool: a cancelled appointment frees its
 * slot, keeps the row for history, and — because these are all FUTURE bookings —
 * never trips the retro-cancel billing lock, which only stamps appointments whose
 * slot has already elapsed.
 *
 * Best-effort by design: if the key is missing or the request fails this logs and
 * returns, because a housekeeping step must never stop the suite from running.
 */
const SEED_SLUG = 'test-appointments-studio'

function env(): { url: string; serviceKey: string | null } {
  const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
  return {
    url: /VITE_SUPABASE_URL=(\S+)/.exec(raw)![1],
    serviceKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      /^SUPABASE_SERVICE_ROLE_KEY=(\S+)/m.exec(raw)?.[1] ??
      null,
  }
}

export default async function globalSetup() {
  let url: string
  let serviceKey: string | null
  try {
    ({ url, serviceKey } = env())
  } catch {
    return
  }

  // Needs the service role: the seed OWNER could cancel these, but that would
  // make every run depend on a login before the first test.
  if (!serviceKey) {
    console.log('[e2e] no SUPABASE_SERVICE_ROLE_KEY — skipping calendar cleanup.')
    console.log('[e2e] if booking specs start failing at the day strip, the seed calendar is full.')
    return
  }

  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
    Prefer: 'return=representation',
  }

  try {
    const orgRes = await fetch(`${url}/rest/v1/organisations?slug=eq.${SEED_SLUG}&select=id`, { headers })
    const org = (await orgRes.json()) as { id: string }[]
    if (!org.length) return

    const now = new Date().toISOString()
    const res = await fetch(
      `${url}/rest/v1/appointments?org_id=eq.${org[0].id}` +
        `&status=in.(approved,completed,no_show)&scheduled_at=gt.${now}&select=id`,
      { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) },
    )
    if (!res.ok) {
      console.log(`[e2e] calendar cleanup skipped: ${res.status} ${await res.text()}`)
      return
    }
    const cleared = (await res.json()) as unknown[]
    if (cleared.length) console.log(`[e2e] freed ${cleared.length} accumulated booking(s) on the seed calendar`)
  } catch (err) {
    console.log('[e2e] calendar cleanup skipped:', err instanceof Error ? err.message : String(err))
  }
}
