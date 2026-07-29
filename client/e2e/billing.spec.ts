import { test, expect } from '@playwright/test'
import { login, signInSeed, restApi, SEED } from './helpers'

/**
 * Post-paid billing core (BILLING_PLAN T1.1). Verifies the owner-facing
 * guarantees of the new schema against the live backend: an owner can READ their
 * own invoices but can neither self-modify billing_status (prevent_billing_self_update)
 * nor write the billing ledger (no INSERT policy). The (org_id, period_start)
 * uniqueness and the service-role path are covered by the migration's DB smoke
 * test; here we assert what a client can actually reach.
 */

test.describe('Billing core — guard + RLS', () => {
  test('owner cannot self-modify billing_status, can read invoices, cannot write the ledger', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id,billing_status`)) as
      { id: string; billing_status: string }[]
    const orgId = org[0].id
    const before = org[0].billing_status

    // Guard: a plain PATCH of billing_status is rejected by prevent_billing_self_update.
    const patch = await fetch(`${ctx.url}/rest/v1/organisations?id=eq.${orgId}`, {
      method: 'PATCH',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ billing_status: 'suspended' }),
    })
    expect(patch.ok).toBeFalsy()
    expect(await patch.text()).toContain('not_authorized')

    // …and the value is unchanged.
    const after = (await restApi(ctx, `organisations?id=eq.${orgId}&select=billing_status`)) as
      { billing_status: string }[]
    expect(after[0].billing_status).toBe(before)

    // Owner CAN read their own billing tables (SELECT policy). Empty is fine.
    const periods = await restApi(ctx, `billing_periods?org_id=eq.${orgId}&select=id`)
    expect(Array.isArray(periods)).toBeTruthy()

    // Owner CANNOT write the ledger — no INSERT policy, so RLS/grant denies it.
    const ins = await fetch(`${ctx.url}/rest/v1/billing_periods`, {
      method: 'POST',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ org_id: orgId, period_start: '2026-06-01', period_end: '2026-07-01' }),
    })
    expect(ins.ok).toBeFalsy()
  })

  test('add a card from Settings → Billing: token stored, nothing charged', async ({ page }) => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const orgId = org[0].id
    // Baseline: adding a card must create no billing period (never charges).
    const periodsBefore = (await restApi(ctx, `billing_periods?org_id=eq.${orgId}&select=id`)) as unknown[]

    await login(page)
    await page.goto('/dashboard/settings/billing')
    await page.getByTestId('billing-add-card').click()
    await expect(page.getByTestId('card-form')).toBeVisible()
    // The "nothing is charged now" disclaimer is on the form (T2.2).
    await expect(page.getByTestId('card-disclaimer')).toBeVisible()

    await page.getByTestId('card-number').fill('4242 4242 4242 4242')
    const yy = String(new Date().getFullYear() + 2).slice(-2)
    await page.getByTestId('card-expiry').fill(`09/${yy}`)
    await page.getByTestId('card-save').click()

    // The card shows with its last 4.
    await expect(page.getByTestId('billing-card')).toContainText('4242', { timeout: 15_000 })

    // Token is stored (a default, active card exists). Owners can't read the
    // token column, but they can see it's there via the metadata.
    const cards = (await restApi(
      ctx,
      `org_payment_methods?org_id=eq.${orgId}&is_default=eq.true&status=eq.active&select=last4,brand`,
    )) as { last4: string; brand: string }[]
    expect(cards.length).toBe(1)
    expect(cards[0].last4).toBe('4242')

    // No charge: adding a card created no billing period.
    const periodsAfter = (await restApi(ctx, `billing_periods?org_id=eq.${orgId}&select=id`)) as unknown[]
    expect(periodsAfter.length).toBe(periodsBefore.length)
  })

  // Suspension + recovery (T3.2). Suspending needs service role (owners can't),
  // so this runs only when the seed org has been pre-suspended out-of-band;
  // otherwise it skips rather than fail the suite. Pay-now restores it.
  test('suspended org: booking page unavailable, dashboard alive, pay-now restores', async ({ page }) => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=billing_status`)) as
      { billing_status: string }[]
    test.skip(org[0].billing_status !== 'suspended', 'requires the seed org pre-suspended (service-role setup)')

    // Booking page shows the friendly unavailable state.
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-unavailable').or(page.getByText(/unavailable|მიუწვდ|недоступ/i)))
      .toBeVisible({ timeout: 20_000 })

    // Dashboard still loads — data isn't hidden over billing.
    await login(page)
    await expect(page).toHaveURL(/\/dashboard/)

    // Billing page shows the dunning banner; pay-now clears it.
    await page.goto('/dashboard/settings/billing')
    await expect(page.getByTestId('billing-dunning')).toBeVisible()
    await page.getByTestId('billing-pay-now').click()
    await expect(page.getByTestId('billing-dunning')).toHaveCount(0, { timeout: 20_000 })

    // Booking works again.
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 20_000 })
  })
})
