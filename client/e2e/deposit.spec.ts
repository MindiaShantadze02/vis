import { test, expect } from '@playwright/test'
import { passBookingOtp, fillStable, bookToDetails, signInSeed, restApi, letterName, SEED } from './helpers'

// Deposits: a service (or the org default) can require an upfront prepayment.
// The booking form then shows a pay-now / due-in-person split and the online
// charge covers just the deposit — the appointment lands as 'deposit_paid'.
//
// NOTE: a successful run creates a real appointment + customer on the seeded org
// (guests can't self-delete), same as booking.spec. The org's deposit default is
// set in beforeAll and restored in afterAll so no other spec sees a deposit.

async function setOrgDeposit(type: 'none' | 'percent' | 'fixed', value: number | null) {
  const ctx = await signInSeed()
  await restApi(ctx, `organisations?slug=eq.${SEED.slug}`, {
    method: 'PATCH',
    body: JSON.stringify({ deposit_type: type, deposit_value: value }),
  })
}

test.describe('Deposits', () => {
  // 50% org-default deposit applies to every service without its own override.
  test.beforeAll(async () => { await setOrgDeposit('percent', 50) })
  test.afterAll(async () => { await setOrgDeposit('none', null) })

  test('a deposit shows the pay-now/in-person split and books as deposit_paid', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open slot this week').toBeTruthy()

    const name = letterName()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), '599776655')

    // The deposit split (pay now vs due in person) + a deposit-worded CTA.
    await expect(page.getByTestId('book-deposit-split')).toBeVisible()
    await expect(page.getByTestId('book-payment-hint')).toBeVisible()
    // Georgian is the default booking-page language; match any locale's "deposit".
    await expect(page.getByTestId('book-submit')).toContainText(/deposit|დეპოზიტ|депозит/i)

    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)

    // Only the deposit is charged online; the mock gateway settles it.
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })
    await page.getByTestId('payment-return-primary').click()
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })

    // Server truth: the appointment is deposit_paid (balance still due in person),
    // not fully 'paid'.
    const ctx = await signInSeed()
    const rows = (await restApi(
      ctx,
      `appointments?select=payment_status,customers!inner(first_name)&customers.first_name=eq.${name}`,
    )) as { payment_status: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].payment_status).toBe('deposit_paid')
  })
})
