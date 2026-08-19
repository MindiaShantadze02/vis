import { test, expect } from '@playwright/test'
import { signInSeed, readSupabaseEnv, SEED } from './helpers'

/**
 * Booking-page view counting (migration 20260829120000).
 *
 * The interesting properties are the privacy/permission ones, and they are all
 * reachable without a service-role key:
 *   - anon can increment the counter (the public booking page must be able to),
 *   - anon can NOT read the table back,
 *   - an unknown slug is a silent no-op, so the RPC can't be used to probe
 *     which businesses exist,
 *   - the same browser only counts once per day (asserted through the real
 *     booking page, since the dedupe lives in localStorage).
 */

async function rpc(url: string, anonKey: string, fn: string, body: unknown) {
  return fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test.describe('Booking page views', () => {
  test('anon can count a view but cannot read the counters back', async () => {
    const { url, anonKey } = readSupabaseEnv()

    const ok = await rpc(url, anonKey, 'record_booking_page_view', { p_slug: SEED.slug })
    expect(ok.ok).toBeTruthy()

    // Unknown slug must behave identically — no error, no signal about whether
    // the business exists.
    const unknown = await rpc(url, anonKey, 'record_booking_page_view', { p_slug: 'definitely-not-a-real-slug' })
    expect(unknown.ok).toBeTruthy()

    // ...but the numbers themselves are not public.
    const read = await fetch(`${url}/rest/v1/booking_page_views?select=views`, {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    })
    expect(read.ok).toBeFalsy()
  })

  test('the owner can read their own org counters', async () => {
    const ctx = await signInSeed()
    const res = await fetch(`${ctx.url}/rest/v1/booking_page_views?select=org_id,day,views`, {
      headers: { apikey: ctx.anonKey, authorization: `Bearer ${ctx.accessToken}` },
    })
    expect(res.ok).toBeTruthy()
    expect(Array.isArray(await res.json())).toBeTruthy()
  })

  test('one visit counts EXACTLY once, and reloads add nothing', async ({ page }) => {
    const calls: string[] = []
    page.on('request', r => {
      if (r.url().includes('/rpc/record_booking_page_view')) calls.push(r.url())
    })

    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 20_000 })
    // Give any duplicate effect invocation time to fire before asserting.
    await page.waitForTimeout(1_000)

    // EXACTLY one. The first version of this test only asserted "> 0", which
    // happily passed while React StrictMode's double-invoked effect was sending
    // two counts per visit — the bug it was supposed to catch.
    expect(calls.length).toBe(1)

    // Reload and revisit: the localStorage day-stamp suppresses both.
    await page.reload()
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 20_000 })
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1_000)

    expect(calls.length).toBe(1)
  })
})
