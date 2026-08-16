import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { login, letterName, cancelAppt, tag, uniquePhone } from './helpers'

/**
 * Public REST API (migration 071 + the `api` edge function): the full
 * integrator journey — mint a key in Settings → API keys, call every endpoint
 * with it, see the booking land in the dashboard, then revoke the key.
 *
 * Like the rest of the suite this talks to the live hosted backend. Residue:
 * the created key ends the run revoked (rows persist, matching the "revoked
 * keys stay listed" UX); the booking is driven to a terminal state via the
 * dashboard, same as booking.spec.
 */

// The API lives on the hosted Supabase project the dev server points at.
const SUPABASE_URL = (() => {
  const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
  return /VITE_SUPABASE_URL=(\S+)/.exec(env)![1]
})()
const API = `${SUPABASE_URL}/functions/v1/api`

/** Business-time (UTC+4) calendar date `offsetDays` from now, "yyyy-MM-dd". */
function businessDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10)
}

async function getJson(request: APIRequestContext, url: string, key: string) {
  const res = await request.get(url, { headers: { 'x-api-key': key } })
  return { status: res.status(), body: await res.json() }
}

/** Mint a key through the settings UI and return the full secret. */
async function createKeyViaUi(page: Page, name: string): Promise<string> {
  await page.goto('/dashboard/settings/api')
  await page.getByTestId('create-api-key').click()
  await page.getByTestId('api-key-name').fill(name)
  await page.getByTestId('api-key-create-submit').click()
  const keyEl = page.getByTestId('new-api-key')
  await expect(keyEl).toBeVisible()
  const key = (await keyEl.innerText()).trim()
  expect(key).toMatch(/^grf_[0-9a-f]{48}$/)
  await page.getByTestId('api-key-done').click()
  return key
}

test.describe('Public REST API', () => {
  test('rejects missing, malformed and unknown keys', async ({ request }) => {
    const noKey = await request.get(`${API}/v1/services`)
    expect(noKey.status()).toBe(401)

    const malformed = await getJson(request, `${API}/v1/services`, 'not-a-vis-key')
    expect(malformed.status).toBe(401)

    const unknown = await getJson(request, `${API}/v1/services`, `grf_${'0'.repeat(48)}`)
    expect(unknown.status).toBe(401)
    expect(unknown.body.error).toBe('invalid_key')
  })

  test('key lifecycle: mint → read endpoints → book → dashboard → revoke', async ({ page, request }) => {
    test.setTimeout(180_000) // several live API round-trips + two UI journeys

    await login(page)
    const key = await createKeyViaUi(page, tag('E2E key'))

    // --- reads are scoped to the key's org --------------------------------
    const org = await getJson(request, `${API}/v1/organisation`, key)
    expect(org.status).toBe(200)
    expect(org.body.organisation.slug).toBe('test-appointments-studio')

    const services = await getJson(request, `${API}/v1/services`, key)
    expect(services.status).toBe(200)
    const service = services.body.services.find((s: { name: string }) => s.name === 'Consultation')
    expect(service).toBeTruthy()
    expect(service.duration_minutes).toBeGreaterThan(0)

    // --- slots: find the first upcoming day with availability -------------
    let date = ''
    let slots: { time: string; remaining: number; total: number }[] = []
    for (let off = 1; off <= 14 && slots.length === 0; off++) {
      date = businessDate(off)
      const res = await getJson(request, `${API}/v1/slots?service_id=${service.id}&date=${date}`, key)
      expect(res.status).toBe(200)
      slots = res.body.slots
    }
    expect(slots.length, 'expected an open day with free slots within 14 days').toBeGreaterThan(0)

    const badDate = await getJson(request, `${API}/v1/slots?service_id=${service.id}&date=15-07-2026`, key)
    expect(badDate.status).toBe(422)

    // --- booking: last slot of the day (least likely to race other specs) --
    const slot = slots[slots.length - 1]
    const customer = letterName()
    const create = await request.post(`${API}/v1/bookings`, {
      headers: { 'x-api-key': key },
      data: {
        service_id: service.id,
        date,
        time: slot.time,
        customer: { first_name: customer, phone: uniquePhone() },
        notes: 'created by api.spec.ts',
      },
    })
    expect(create.status()).toBe(201)
    const booking = (await create.json()).booking
    // Bookings are always created approved — the pending-approval workflow and
    // the `status` request field were removed (2026-08-14).
    expect(booking.status).toBe('approved')

    // capacity is consumed: the slot shrank or disappeared
    const after = await getJson(request, `${API}/v1/slots?service_id=${service.id}&date=${date}`, key)
    const slotAfter = after.body.slots.find((s: { time: string }) => s.time === slot.time)
    if (slotAfter) expect(slotAfter.remaining).toBe(slot.remaining - 1)

    // validation failures surface as clean 422s (never 500s that leak internals)
    const badPhone = await request.post(`${API}/v1/bookings`, {
      headers: { 'x-api-key': key },
      data: { service_id: service.id, date, time: slot.time, customer: { first_name: 'Test', phone: '123' } },
    })
    expect(badPhone.status()).toBe(422)
    expect((await badPhone.json()).error).toBe('invalid_phone')

    // oversized inputs are rejected before the DB (length caps, storage-abuse guard)
    const longName = await request.post(`${API}/v1/bookings`, {
      headers: { 'x-api-key': key },
      data: { service_id: service.id, date, time: slot.time, customer: { first_name: 'A'.repeat(150), phone: '555111222' } },
    })
    expect(longName.status()).toBe(422)
    expect((await longName.json()).error).toBe('invalid_name')

    const longNotes = await request.post(`${API}/v1/bookings`, {
      headers: { 'x-api-key': key },
      data: { service_id: service.id, date, time: slot.time, notes: 'x'.repeat(600), customer: { first_name: 'Test', phone: '555111222' } },
    })
    expect(longNotes.status()).toBe(422)
    expect((await longNotes.json()).error).toBe('invalid_notes')

    // --- the booking is a real appointment in the dashboard ----------------
    await cancelAppt(page, customer) // asserts visibility, then cleans up

    // --- revocation cuts access immediately --------------------------------
    await page.goto('/dashboard/settings/api')
    await page.getByTestId('api-key-revoke').first().click()
    await page.getByTestId('api-key-confirm-revoke').click()
    await expect(page.getByTestId('api-key-confirm-revoke')).toBeHidden()
    const revoked = await getJson(request, `${API}/v1/services`, key)
    expect(revoked.status).toBe(401)
  })
})
