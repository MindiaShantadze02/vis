import { test, expect, type Page } from '@playwright/test'
import {
  login, bookToDetails, openApptByName, passBookingOtp, fillStable,
  letterName, uniquePhone, setOnlinePayments, signInSeed, restApi,
} from './helpers'

/**
 * Cancel-with-refund of a PAID online appointment (migration 086 +
 * refund-payment edge fn), end to end against the live backend's MOCK payment
 * provider:
 *
 *   guest books online → mock checkout "success" (payment-webhook creates the
 *   appointment approved+paid) → owner cancels with the refund box ticked
 *   (default) → refund-payment flips status='cancelled' AND
 *   payment_status='refunded' in one call.
 *
 * The webhook's OTHER refund path (auto-refund when fulfilment fails after a
 * cleared charge) needs a mid-checkout slot conflict to trigger and is not
 * driven from e2e — see e2e/README.md.
 *
 * NOTE: a successful run leaves a cancelled+refunded appointment + customer on
 * the seeded org (guests can't self-delete; same persistence as booking.spec).
 */
test.describe('Refunds — cancel a paid online booking', () => {
  // The Step-3 payment selector only offers "online" when the org has a
  // gateway enabled; flip it on for this spec and restore the resting default.
  test.beforeAll(async () => { await setOnlinePayments(true) })
  test.afterAll(async () => { await setOnlinePayments(false) })

  const dialog = (page: Page) => page.getByRole('dialog')

  test('owner cancels with refund: status + payment flip together', async ({ page }) => {
    const name = letterName()

    // ── Guest: book & pay online through the mock gateway ──────────────────
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), uniquePhone())
    // Both in-person and online are enabled, so the method selector renders.
    await page.getByTestId('book-pay-online').click()
    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)

    // OTP verified → create-payment parks the booking and redirects to the
    // mock checkout; simulating success drives payment-webhook (mock branch).
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })

    // ── Owner: cancel with the refund checkbox (default: ticked) ───────────
    await login(page)
    await openApptByName(page, name)
    // Paid online bookings are born approved (webhook), so cancel is offered.
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()
    await dialog(page).getByTestId('appt-cancel').click()

    // The refund choice appears only in the confirm step and only for
    // paid-online appointments — and defaults to giving the money back.
    const checkbox = dialog(page).getByTestId('appt-refund-checkbox')
    await expect(checkbox).toBeVisible()
    await expect(checkbox.locator('input')).toBeChecked()

    await dialog(page).getByTestId('appt-confirm-cancel').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })

    // ── Assert both effects landed atomically ───────────────────────────────
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-cancelled')).toBeVisible()
    // Payment line shows the refunded state (ka locale).
    await expect(dialog(page)).toContainText('თანხა დაბრუნებულია')
    // No refund checkbox on a terminal appointment (no cancel button at all).
    await expect(dialog(page).getByTestId('appt-cancel')).toHaveCount(0)

    // Server state: payment_status really is 'refunded' (not just local UI).
    const ctx = await signInSeed()
    const rows = (await restApi(
      ctx,
      `appointments?select=payment_status,status,customers!inner(first_name)&customers.first_name=eq.${name}`,
    )) as { payment_status: string; status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('cancelled')
    expect(rows[0].payment_status).toBe('refunded')

    // Erase the guest's PII (Art. 16) — doubles as cleanup, same as
    // appointment-status.spec.
    await dialog(page).getByTestId('appt-erase').click()
    await dialog(page).getByTestId('appt-confirm-erase').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })
  })
})
