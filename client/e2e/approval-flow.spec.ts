import { test, expect } from '@playwright/test'
import {
  login, fillStable, bookToDetails, passBookingOtp, letterName,
  setPaymentMethods, setRequireApproval, signInSeed, restApi,
} from './helpers'

/**
 * Manual approval (migration 20260822120000). Opt-in per org, and deliberately
 * narrow: it gates ON-SITE bookings only — anything paid online or carrying a
 * deposit is auto-approved, because the money already moved.
 *
 * Two rules matter more than the happy path and are asserted explicitly:
 *   1. an ONLINE booking still auto-approves even with the toggle ON;
 *   2. Vis does not bill a pending request — only approving makes it billable.
 *
 * EVERY test must restore `require_approval = false` (the seed's resting state)
 * in a `finally`. Leaving it on would make every later booking spec produce
 * 'pending' rows and cascade failures through the suite.
 */
test.describe('Manual approval', () => {
  test('the toggle is off by default and persists when switched on', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/booking')

    const toggle = page.getByTestId('require-approval-toggle').locator('input')
    await expect(toggle).toBeVisible()
    await expect(toggle, 'auto-approve is the default').not.toBeChecked()

    try {
      await toggle.check()
      await page.getByTestId('booking-save').click()
      await expect(page.getByTestId('toast')).toBeVisible()
      await page.reload()
      await expect(page.getByTestId('require-approval-toggle').locator('input')).toBeChecked()
    } finally {
      await setRequireApproval(false)
    }
  })

  test('an on-site booking becomes a request, then approving confirms it', async ({ page }) => {
    const ctx = await signInSeed()
    const name = letterName()

    try {
      await setRequireApproval(true)
      // On-site only, so the booking is the direct insert that the approval gate
      // sits on. (Online is covered by the auto-approve test below.)
      await setPaymentMethods({ online: false, inPerson: true })

      // ── Customer books ───────────────────────────────────────────────────
      expect(await bookToDetails(page), 'expected an open day with a free slot').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), name)
      await fillStable(page.getByTestId('book-phone'), '599110022')
      // The form warns BEFORE booking that this business confirms manually.
      await expect(page.getByTestId('book-approval-hint')).toBeVisible()
      await page.getByTestId('book-submit').click()
      await passBookingOtp(page)

      // The confirmation page says "request sent", not "confirmed".
      await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })
      await expect(page.getByTestId('status-pending')).toBeVisible({ timeout: 20_000 })

      // ── Server: pending, and NOT billable ────────────────────────────────
      const rows = await restApi(
        ctx,
        `appointments?select=id,status,customers!inner(first_name)&customers.first_name=eq.${name}`,
      ) as { id: string; status: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending')

      const billable = await restApi(
        ctx, `appointments?id=eq.${rows[0].id}&status=in.(approved,completed,no_show)&select=id`,
      ) as unknown[]
      expect(billable, 'a pending request must not be billable').toHaveLength(0)

      // ── Owner sees it first in the list, and approves ────────────────────
      await login(page)
      await page.goto('/dashboard')
      const first = page.getByTestId('appt-row').first()
      await expect(first).toContainText(name, { timeout: 20_000 })

      await first.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByTestId('appt-approve').click()

      await expect.poll(async () => {
        const after = await restApi(ctx, `appointments?id=eq.${rows[0].id}&select=status`) as { status: string }[]
        return after[0]?.status
      }, { timeout: 20_000 }).toBe('approved')
    } finally {
      await setRequireApproval(false)
      await setPaymentMethods({ online: true, inPerson: true })
    }
  })

  test('declining a request rejects it', async ({ page }) => {
    const ctx = await signInSeed()
    const name = letterName()

    try {
      await setRequireApproval(true)
      await setPaymentMethods({ online: false, inPerson: true })

      expect(await bookToDetails(page), 'expected an open day with a free slot').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), name)
      await fillStable(page.getByTestId('book-phone'), '599110033')
      await page.getByTestId('book-submit').click()
      await passBookingOtp(page)
      await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })

      const rows = await restApi(
        ctx,
        `appointments?select=id,status,customers!inner(first_name)&customers.first_name=eq.${name}`,
      ) as { id: string }[]

      await login(page)
      await page.goto('/dashboard')
      const first = page.getByTestId('appt-row').first()
      await expect(first).toContainText(name, { timeout: 20_000 })
      await first.click()
      await page.getByTestId('appt-reject').click()

      await expect.poll(async () => {
        const after = await restApi(ctx, `appointments?id=eq.${rows[0].id}&select=status`) as { status: string }[]
        return after[0]?.status
      }, { timeout: 20_000 }).toBe('rejected')
    } finally {
      await setRequireApproval(false)
      await setPaymentMethods({ online: true, inPerson: true })
    }
  })

  test('the owner can book on their own page while signed in', async ({ page }) => {
    // Regression (20260822140000): doing this failed with the generic
    // "couldn't finish your booking". normalize_guest_appointment exempts org
    // members and returns before pinning fields, and payment_method was NOT NULL
    // with no default — so the form, which relies on the trigger, blew up. Only
    // the owner testing their own page was affected, which is why every other
    // spec (fresh anonymous context) missed it.
    const ctx = await signInSeed()
    const name = letterName()

    try {
      await setPaymentMethods({ online: false, inPerson: true })
      await login(page)                       // ← the ingredient that broke it
      expect(await bookToDetails(page), 'expected an open day with a free slot').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), name)
      await fillStable(page.getByTestId('book-phone'), '599110055')
      await page.getByTestId('book-submit').click()
      // The DB exempts members from enforce_booking_verification, but the CLIENT
      // flow is identical for everyone — the OTP step still shows.
      await passBookingOtp(page)
      await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })

      const rows = await restApi(
        ctx,
        `appointments?select=status,payment_method,customers!inner(first_name)&customers.first_name=eq.${name}`,
      ) as { status: string; payment_method: string }[]
      expect(rows).toHaveLength(1)
      // The column defaults now fill what the exempted trigger skipped.
      expect(rows[0].payment_method).toBe('in_person')
      expect(rows[0].status, 'must NOT fall through to the old pending default').toBe('approved')
    } finally {
      await setPaymentMethods({ online: true, inPerson: true })
    }
  })

  test('an ONLINE booking still auto-approves with approval turned on', async ({ page }) => {
    // The core of the rule: approval is for on-site bookings only. A customer
    // who has already paid must never be left waiting on the business.
    const ctx = await signInSeed()
    const name = letterName()

    try {
      await setRequireApproval(true)
      // Seed default is both methods on, with online preselected.
      expect(await bookToDetails(page), 'expected an open day with a free slot').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), name)
      await fillStable(page.getByTestId('book-phone'), '599110044')
      // No approval warning on the online path.
      await expect(page.getByTestId('book-approval-hint')).toHaveCount(0)
      await page.getByTestId('book-submit').click()
      await passBookingOtp(page)

      await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
      await page.getByTestId('mock-pay-success').click()
      await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })

      await expect.poll(async () => {
        const rows = await restApi(
          ctx,
          `appointments?select=status,customers!inner(first_name)&customers.first_name=eq.${name}`,
        ) as { status: string }[]
        return rows[0]?.status
      }, { timeout: 30_000 }).toBe('approved')
    } finally {
      await setRequireApproval(false)
    }
  })
})
