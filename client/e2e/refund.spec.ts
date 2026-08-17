import { test, expect, type Page } from '@playwright/test'
import {
  login, bookToDetails, openApptByName, passBookingOtp, fillStable,
  letterName, uniquePhone, setOnlinePayments, signInSeed, restApi, eraseClientByName,
  seedUpcomingAppointment,
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
 * The second test covers the STANDALONE refund (no cancel): the same function
 * called without a new_status, which returns the money and only cancels the
 * booking when it is still live. It also asserts the appointment_refunds ledger
 * row — amount, actor and reason — which is what a business can actually read
 * back (payment_log stays superadmin-only).
 *
 * The webhook's OTHER refund path (auto-refund when fulfilment fails after a
 * cleared charge) needs a mid-checkout slot conflict to trigger and is not
 * driven from e2e — see e2e/README.md.
 *
 * NOTE: a successful run leaves a cancelled+refunded appointment + customer on
 * the seeded org (guests can't self-delete; same persistence as booking.spec).
 */
test.describe('Refunds — cancel a paid online booking', () => {
  // Priced services always pay online now; enabling a gateway is no longer
  // required, but we flip it on (and restore it) to keep the org's config
  // representative of a business that collects online payments.
  test.beforeAll(async () => { await setOnlinePayments(true) })
  test.afterAll(async () => { await setOnlinePayments(false) })

  const dialog = (page: Page) => page.getByRole('dialog')

  /** Guest books and pays online through the mock gateway; returns the customer
   *  name the appointment can be found by. */
  async function bookAndPay(page: Page): Promise<string> {
    const name = letterName()
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), uniquePhone())
    // Pay-in-person was removed: a priced service is always charged online, so
    // there's no method selector — the Book button proceeds straight to payment.
    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)

    // OTP verified → create-payment parks the booking and redirects to the
    // mock checkout; simulating success drives payment-webhook (mock branch).
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })
    return name
  }

  test('owner cancels with refund: status + payment flip together', async ({ page }) => {
    const name = await bookAndPay(page)

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

    // Erase the guest's PII (Art. 16) from the Clients screen — doubles as
    // cleanup, same as appointment-status.spec.
    await eraseClientByName(page, name)
  })

  test('a standalone refund returns the money and records who did it', async ({ page }) => {
    const name = await bookAndPay(page)

    await login(page)
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()

    // The Refund button lives in the drawer BODY, so it doesn't depend on the
    // action footer (which only exists for approved appointments).
    await dialog(page).getByTestId('appt-refund').click()

    // The amount is quoted by the server from what was actually charged.
    const confirm = page.getByTestId('appt-refund-confirm')
    await expect(confirm).toBeEnabled({ timeout: 20_000 })
    await page.getByTestId('appt-refund-reason').fill('e2e: standalone refund')
    await confirm.click()

    // Back in the drawer: the receipt replaces the button.
    await expect(dialog(page).getByTestId('appt-refund-summary')).toBeVisible({ timeout: 20_000 })
    await expect(dialog(page).getByTestId('appt-refund')).toHaveCount(0)

    // Server truth: the booking was still live, so it was cancelled too, and the
    // ledger row is readable by the owner (proving the new RLS policy).
    const ctx = await signInSeed()
    const rows = (await restApi(
      ctx,
      `appointments?select=id,payment_status,status,customers!inner(first_name)&customers.first_name=eq.${name}`,
    )) as { id: string; payment_status: string; status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].payment_status).toBe('refunded')
    expect(rows[0].status).toBe('cancelled')

    const refunds = (await restApi(
      ctx,
      `appointment_refunds?select=amount,status,initiated_via,initiated_by,reason,cancelled_appointment&appointment_id=eq.${rows[0].id}`,
    )) as {
      amount: string; status: string; initiated_via: string
      initiated_by: string | null; reason: string | null; cancelled_appointment: boolean
    }[]
    expect(refunds).toHaveLength(1)
    expect(refunds[0].status).toBe('succeeded')
    expect(Number(refunds[0].amount)).toBeGreaterThan(0)
    expect(refunds[0].initiated_via).toBe('admin')
    expect(refunds[0].initiated_by).not.toBeNull()
    expect(refunds[0].reason).toBe('e2e: standalone refund')
    expect(refunds[0].cancelled_appointment).toBe(true)

    // A second refund is refused by the atomic claim, not just hidden in the UI.
    const second = await fetch(`${ctx.url}/functions/v1/refund-payment`, {
      method: 'POST',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ appointment_id: rows[0].id }),
    })
    expect(second.status).toBe(409)
    expect((await second.json()).error).toBe('already_refunded')

    await eraseClientByName(page, name)
  })

  test('a booking cancelled without a refund can still be refunded afterwards', async ({ page }) => {
    const name = await bookAndPay(page)

    // Cancel while UNTICKING the refund box — the money stays with the business.
    await login(page)
    await openApptByName(page, name)
    await dialog(page).getByTestId('appt-cancel').click()
    await dialog(page).getByTestId('appt-refund-checkbox').locator('input').uncheck()
    await dialog(page).getByTestId('appt-confirm-cancel').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })

    // The refund door is still open on a cancelled booking — this is the whole
    // point of decoupling money from schedule.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-cancelled')).toBeVisible()
    await dialog(page).getByTestId('appt-refund').click()
    const confirm = page.getByTestId('appt-refund-confirm')
    await expect(confirm).toBeEnabled({ timeout: 20_000 })
    await confirm.click()
    await expect(dialog(page).getByTestId('appt-refund-summary')).toBeVisible({ timeout: 20_000 })

    // Status is untouched: it was already cancelled, and refunding must not
    // rewrite it.
    const ctx = await signInSeed()
    const rows = (await restApi(
      ctx,
      `appointments?select=id,payment_status,status,customers!inner(first_name)&customers.first_name=eq.${name}`,
    )) as { id: string; payment_status: string; status: string }[]
    expect(rows[0].status).toBe('cancelled')
    expect(rows[0].payment_status).toBe('refunded')

    const refunds = (await restApi(
      ctx,
      `appointment_refunds?select=cancelled_appointment&appointment_id=eq.${rows[0].id}`,
    )) as { cancelled_appointment: boolean }[]
    // It did not cancel anything — the booking was already cancelled.
    expect(refunds[0].cancelled_appointment).toBe(false)

    await eraseClientByName(page, name)
  })

  test('an unpaid in-person booking offers no refund at all', async ({ page }) => {
    const ctx = await signInSeed()
    const name = letterName()
    const apptId = await seedUpcomingAppointment(name)

    await login(page)
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('appt-refund')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-refund-summary')).toHaveCount(0)

    await restApi(ctx, `appointments?id=eq.${apptId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
    })
    await eraseClientByName(page, name)
  })
})
