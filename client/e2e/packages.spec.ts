import { test, expect } from '@playwright/test'
import { login, signInSeed, restApi, letterName, uniquePhone, tag, SEED, type SeedCtx } from './helpers'

/**
 * Session packages (abonements, migration 20260723120000). The full
 * sell → book series → consume → cancel → refund lifecycle runs through the real
 * authenticated edge functions + RPCs (deterministic, no slot flakiness); the
 * PackagesSettings catalogue and the add-appointment redemption picker get
 * focused UI checks.
 */

// Far-future weekday start at 10:00 business (06:00Z) so weekly occurrences land
// on free slots (mirrors recurring.spec).
function futureStart(): string {
  const d = new Date(Date.now() + (40 + (Date.now() % 200)) * 86_400_000)
  d.setUTCHours(6, 0, 0, 0)
  return d.toISOString()
}

async function orgAndService(ctx: SeedCtx): Promise<{ orgId: string; serviceId: string }> {
  const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
  const svc = (await restApi(ctx, `services?org_id=eq.${org[0].id}&is_active=eq.true&order=sort_order&select=id&limit=1`)) as { id: string }[]
  return { orgId: org[0].id, serviceId: svc[0].id }
}

/** Create a catalogue package as the owner; returns its id. */
async function createPackage(
  ctx: SeedCtx,
  orgId: string,
  fields: { name: string; session_count: number; price: number; service_id?: string | null; validity_days?: number | null },
): Promise<string> {
  const rows = (await restApi(ctx, 'packages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ org_id: orgId, active: true, service_id: null, validity_days: null, ...fields }),
  })) as { id: string }[]
  return rows[0].id
}

/**
 * Sell + settle a package the way the UI does: create-payment parks a PENDING
 * customer_packages row and hands back the mock checkout URL (which carries the
 * row id + provider ref), then the mock payment-webhook settles it to 'paid'.
 * Returns the customer_packages id.
 */
async function sellAndSettle(
  ctx: SeedCtx,
  orgId: string,
  packageId: string,
  first: string,
  phone: string,
): Promise<string> {
  const fn = `${ctx.url}/functions/v1/`
  const authHeaders = { apikey: ctx.anonKey, authorization: `Bearer ${ctx.accessToken}`, 'content-type': 'application/json' }

  const createRes = await fetch(`${fn}create-payment`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      purpose: 'package',
      org_id: orgId,
      package_id: packageId,
      first_name: first,
      phone,
      idempotency_key: crypto.randomUUID(),
      returnBaseUrl: 'http://localhost:5173',
    }),
  })
  expect(createRes.ok, `create-payment package → ${createRes.status}`).toBeTruthy()
  const { checkoutUrl } = (await createRes.json()) as { checkoutUrl: string }
  const u = new URL(checkoutUrl)
  const cpId = u.searchParams.get('id')!
  const ref = u.searchParams.get('ref')!
  expect(cpId).toBeTruthy()

  const hookRes = await fetch(`${fn}payment-webhook`, {
    method: 'POST',
    headers: { apikey: ctx.anonKey, authorization: `Bearer ${ctx.anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'mock', purpose: 'package', id: cpId, ref, outcome: 'paid' }),
  })
  expect(hookRes.ok, `payment-webhook package → ${hookRes.status}`).toBeTruthy()
  return cpId
}

/** Find one sold package by id from the owner RPC. */
async function soldPackage(ctx: SeedCtx, orgId: string, cpId: string) {
  const list = (await restApi(ctx, 'rpc/get_org_customer_packages', {
    method: 'POST',
    body: JSON.stringify({ p_org_id: orgId }),
  })) as Array<{ id: string; sessions_total: number; sessions_used: number; payment_status: string }>
  return list.find(p => p.id === cpId)!
}

test.describe('Session packages', () => {
  test('sell → book series → consume → cancel → refund', async () => {
    const ctx = await signInSeed()
    const { orgId, serviceId } = await orgAndService(ctx)

    // Sell an 8-session package tied to the seed service.
    const packageId = await createPackage(ctx, orgId, {
      name: tag('E2E 8-pack'), session_count: 8, price: 100, service_id: serviceId,
    })
    const first = letterName()
    const cpId = await sellAndSettle(ctx, orgId, packageId, first, uniquePhone())

    // Settled: 8 sessions, none used.
    let sold = await soldPackage(ctx, orgId, cpId)
    expect(sold.payment_status).toBe('paid')
    expect(sold.sessions_total).toBe(8)
    expect(sold.sessions_used).toBe(0)

    // Book a weekly series against the package (its customer is reused).
    const series = (await restApi(ctx, 'rpc/create_recurrence_series', {
      method: 'POST',
      body: JSON.stringify({
        p_org_id: orgId, p_service_id: serviceId, p_staff_id: null,
        p_first_name: first, p_last_name: null, p_phone: uniquePhone(),
        p_start_at: futureStart(), p_cadence: 'weekly', p_end_type: 'count',
        p_occurrence_count: 3, p_until_date: null, p_notes: null,
        p_customer_package_id: cpId,
      }),
    })) as { series_id: string; made: number; skipped: number }
    expect(series.made + series.skipped).toBe(3)
    expect(series.made).toBeGreaterThanOrEqual(1)

    // Each made occurrence consumed one session (the trigger's job).
    sold = await soldPackage(ctx, orgId, cpId)
    expect(sold.sessions_used).toBe(series.made)

    // Cancelling the series refunds every consumed session.
    const cancelled = (await restApi(ctx, 'rpc/cancel_recurrence_series', {
      method: 'POST', body: JSON.stringify({ p_series_id: series.series_id }),
    })) as number
    expect(cancelled).toBe(series.made)

    sold = await soldPackage(ctx, orgId, cpId)
    expect(sold.sessions_used).toBe(0)
  })

  test('the catalogue page creates and lists a package', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/packages')

    const name = tag('E2E UI pack')
    await page.getByTestId('packages-add').click()
    await expect(page.getByTestId('package-form')).toBeVisible()
    await page.getByTestId('package-form-name').fill(name)
    await page.getByTestId('package-form-count').fill('10')
    await page.getByTestId('package-form-price').fill('150')
    await page.getByTestId('package-save').click()

    // The new package appears in the catalogue with its session count.
    const row = page.getByTestId('package-row').filter({ hasText: name })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText('10')

    // Clean up this unsold package (delete is allowed while it has no sales).
    await row.getByTestId('package-delete').click()
    await page.getByRole('button', { name: /delete|წაშ|удал/i }).last().click()
    await expect(page.getByTestId('package-row').filter({ hasText: name })).toHaveCount(0, { timeout: 15_000 })
  })

  test('the add-appointment dialog exposes a redemption picker that pins the customer', async ({ page }) => {
    // Sell a package so a redeemable option exists for the dialog.
    const ctx = await signInSeed()
    const { orgId, serviceId } = await orgAndService(ctx)
    const packageId = await createPackage(ctx, orgId, {
      name: tag('E2E redeem'), session_count: 5, price: 80, service_id: serviceId,
    })
    const first = letterName()
    await sellAndSettle(ctx, orgId, packageId, first, uniquePhone())

    await login(page)
    await page.getByTestId('appt-add-btn').click()
    await expect(page.getByTestId('add-appt-dialog')).toBeVisible()

    // The redeem picker is present; choosing our package pins the customer name
    // (read-only) and shows the remaining-sessions counter.
    const picker = page.getByTestId('add-appt-package')
    await expect(picker).toBeVisible()
    await picker.click()
    await page.getByRole('option', { name: new RegExp(first) }).click()
    await expect(page.getByTestId('add-appt-package-remaining')).toBeVisible()
    await expect(page.getByTestId('add-appt-first-name')).toBeDisabled()
  })
})
