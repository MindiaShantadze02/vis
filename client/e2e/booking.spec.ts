import { test, expect } from '@playwright/test'
import { passBookingOtp, fillStable, bookToDetails } from './helpers'

test.describe('Public booking', () => {
  // NOTE: a successful run creates a real pending appointment + customer on the
  // seeded org (guests can't self-delete). See e2e/README.md.
  test('a guest books an in-person appointment end to end', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()

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

  test('submit stays disabled for an invalid name or phone', async ({ page }) => {
    expect(await bookToDetails(page)).toBeTruthy()
    const submit = page.getByTestId('book-submit')

    // Digits in the name are rejected by isValidPersonName.
    await fillStable(page.getByTestId('book-first-name'), 'Nino2')
    await fillStable(page.getByTestId('book-phone'), '599112233')
    await expect(submit).toBeDisabled()

    // Fix the name but break the phone (too short).
    await fillStable(page.getByTestId('book-first-name'), 'Nino')
    await fillStable(page.getByTestId('book-phone'), '123')
    await expect(submit).toBeDisabled()
  })

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

  // --- Pairwise gating of the Step-3 form (canBook), all non-submitting ---

  test('book-submit gating across field combinations (pairwise)', async ({ page }) => {
    expect(await bookToDetails(page)).toBeTruthy() // leaves consent ticked
    const submit = page.getByTestId('book-submit')
    const fn = page.getByTestId('book-first-name')
    const ln = page.getByTestId('book-last-name')
    const phone = page.getByTestId('book-phone')
    const consent = page.getByTestId('book-consent').locator('input')

    // Nothing filled yet → disabled.
    await expect(submit).toBeDisabled()

    // All valid (first + last + phone + consent) → enabled.
    await fillStable(fn, 'Nino')
    await fillStable(ln, 'Beridze')
    await fillStable(phone, '599112233')
    await expect(submit).toBeEnabled()

    // Invalid first name (contains a digit) → disabled.
    await fillStable(fn, 'Nino2')
    await expect(submit).toBeDisabled()

    // First name too short (1 char) → disabled.
    await fillStable(fn, 'N')
    await expect(submit).toBeDisabled()

    // Valid first name, invalid last name → disabled.
    await fillStable(fn, 'Nino')
    await fillStable(ln, 'Beridze9')
    await expect(submit).toBeDisabled()

    // Valid names, invalid phone → disabled.
    await fillStable(ln, 'Beridze')
    await fillStable(phone, '123')
    await expect(submit).toBeDisabled()

    // Everything valid but consent unticked → disabled.
    await fillStable(phone, '599112233')
    await expect(submit).toBeEnabled()
    await consent.uncheck()
    await expect(submit).toBeDisabled()

    // Consent back on → enabled again.
    await consent.check()
    await expect(submit).toBeEnabled()
    // Never submitted — no appointment created.
  })

  test('error-guessing: whitespace, script-injection, and +995-pasted phone', async ({ page }) => {
    expect(await bookToDetails(page)).toBeTruthy()
    const submit = page.getByTestId('book-submit')
    const fn = page.getByTestId('book-first-name')
    const phone = page.getByTestId('book-phone')

    // Whitespace-only name is not a valid person name.
    await fillStable(fn, '   ')
    await fillStable(phone, '599112233')
    await expect(submit).toBeDisabled()

    // A script-injection attempt is rejected by isValidPersonName.
    await fillStable(fn, '<script>')
    await expect(submit).toBeDisabled()

    // A phone pasted in full +995 form is normalized and accepted.
    await fillStable(fn, 'Nino')
    await fillStable(phone, '+995 599 11 22 33')
    await expect(submit).toBeEnabled()
  })
})
