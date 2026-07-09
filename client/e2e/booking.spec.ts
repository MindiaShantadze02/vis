import { test, expect } from '@playwright/test'
import { passBookingOtp, fillStable, bookToDetails } from './helpers'

test.describe('Public booking', () => {
  // NOTE: a successful run creates a real pending appointment + customer on the
  // seeded org (guests can't self-delete). See e2e/README.md.
  test('a guest books an in-person appointment end to end', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()

    // The quiet "Powered by Vis" growth-loop footer is on every booking page.
    await expect(page.getByTestId('powered-by-vis')).toBeVisible()

    // Step 3 — customer details (seeded org is in-person only, so no pay selector).
    // Name must be letters only (isValidPersonName rejects digits).
    await fillStable(page.getByTestId('book-first-name'), 'Nino')
    await fillStable(page.getByTestId('book-phone'), '599112233')
    await expect(page.getByTestId('book-submit')).toBeEnabled()
    await page.getByTestId('book-submit').click()

    // Phone verification with the master OTP
    await passBookingOtp(page)

    // Confirmation page
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /ჯავშანი (მიღებულია|დადასტურებულია)/ })).toBeVisible()
    await expect(page.getByTestId('confirm-book-another')).toBeVisible()
  })

  test('an unknown org slug shows a not-found state', async ({ page }) => {
    await page.goto('/book/this-slug-does-not-exist-xyz')
    // BookingLayout renders an empty/unavailable state rather than the wizard.
    await expect(page.getByTestId('book-service')).toHaveCount(0)
  })

  // --- edge cases ---
  // Step-3 field gating (pairwise/BVA/error-guessing) is data-driven now — see
  // e2e/data/booking-customer.json + e2e/data-driven/booking-customer.spec.ts.

  test('a wrong OTP is rejected and stays on the verification step', async ({ page }) => {
    expect(await bookToDetails(page)).toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), 'Nino')
    await fillStable(page.getByTestId('book-phone'), '599445566')
    await page.getByTestId('book-submit').click()

    // Enter a wrong code — verification fails, no appointment is created.
    await page.getByTestId('book-otp-code').fill('111111')
    await page.getByTestId('book-otp-verify').click()

    await expect(page.getByTestId('book-error')).toBeVisible()
    await expect(page).not.toHaveURL(/\/booking-confirmation\//)
  })
})
