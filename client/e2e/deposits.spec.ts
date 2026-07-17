import { test, expect, type Page } from '@playwright/test'
import {
  login, bookToDetails, openApptByName, passBookingOtp, fillStable,
  letterName, uniquePhone, setOnlinePayments, setServiceDeposit,
  signInSeed, restApi,
} from './helpers'

/**
 * Deposits (Phase 2, migrations 089/090) end to end against the MOCK payment
 * provider: a service with a deposit forces the online path on the booking page
 * (pay-in-person would bypass the deposit), the customer is charged only the
 * deposit through the mock gateway, and payment-webhook materialises the
 * appointment as approved + payment_status='deposit_paid'.
 *
 * NOTE: a successful run leaves a deposit_paid appointment + customer on the
 * seeded org until the erase step (guests can't self-delete; same persistence
 * as booking.spec / refund.spec).
 */
test.describe('Deposits — booking', () => {
  // A 50% deposit on the seed services + online enabled. Both restored after,
  // or later booking specs would see a forced-online deposit flow.
  test.beforeAll(async () => {
    await setOnlinePayments(true)
    await setServiceDeposit('percent', 50)
  })
  test.afterAll(async () => {
    await setServiceDeposit(null, null)
    await setOnlinePayments(false)
  })

  const dialog = (page: Page) => page.getByRole('dialog')

  test('a deposit forces online payment and settles as deposit_paid', async ({ page }) => {
    const name = letterName()

    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), uniquePhone())

    // Deposit required → the deposit breakdown shows and pay-in-person is NOT
    // offered (the method toggle is hidden; only online remains).
    await expect(page.getByTestId('book-deposit-breakdown')).toBeVisible()
    await expect(page.getByTestId('book-deposit-amount')).toBeVisible()
    await expect(page.getByTestId('book-pay-in_person')).toHaveCount(0)

    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)

    // OTP verified → create-payment parks the booking (deposit amount) and
    // redirects to the mock checkout; success drives payment-webhook.
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })

    // Server state: the appointment exists, approved, with a partial deposit.
    const ctx = await signInSeed()
    const rows = (await restApi(
      ctx,
      `appointments?select=status,payment_status,customers!inner(first_name)&customers.first_name=eq.${name}`,
    )) as { status: string; payment_status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('approved')
    expect(rows[0].payment_status).toBe('deposit_paid')

    // Erase the guest's PII (Art. 16) — doubles as cleanup.
    await login(page)
    await openApptByName(page, name)
    await dialog(page).getByTestId('appt-erase').click()
    await dialog(page).getByTestId('appt-confirm-erase').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
  })
})

/**
 * No-show (migration 089): an owner marks an approved appointment as a no-show —
 * a first-class status distinct from cancel (the slot was consumed, so it still
 * counts toward usage, and any deposit is kept per policy).
 */
test.describe('No-show', () => {
  const dialog = (page: Page) => page.getByRole('dialog')

  test('owner marks an approved appointment as no-show', async ({ page }) => {
    const name = letterName()

    // Resting default: in-person + auto-approve, so this books an approved
    // appointment without any payment step.
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), uniquePhone())
    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })

    await login(page)
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()

    await dialog(page).getByTestId('appt-no-show').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })

    // Reopen: the status is now no_show.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-no_show')).toBeVisible()

    // Cleanup: erase the guest PII.
    await dialog(page).getByTestId('appt-erase').click()
    await dialog(page).getByTestId('appt-confirm-erase').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
  })
})
