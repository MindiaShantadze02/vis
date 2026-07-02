import { test, expect } from '@playwright/test'
import { SEED, passBookingOtp, fillStable } from './helpers'

test.describe('Public booking', () => {
  // NOTE: a successful run creates a real pending appointment + customer on the
  // seeded org (guests can't self-delete). See e2e/README.md.
  test('a guest books an in-person appointment end to end', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}`)

    // Step 1 — choose the service. The public page fetches the org first; under a
    // loaded dev server that can take a while, so wait generously for the card.
    const service = page.getByTestId('book-service').first()
    await service.waitFor({ state: 'visible', timeout: 30_000 })
    await service.click()

    // Step 2 — pick the first day that actually exposes free slots
    await expect(page.getByRole('heading', { name: 'თარიღის არჩევა' })).toBeVisible()
    const days = page.locator('[data-testid^="book-day-"][data-disabled="false"]')
    await expect(days.first()).toBeVisible()

    let booked = false
    for (let i = 0, n = await days.count(); i < n; i++) {
      await days.nth(i).click()
      const slot = page.getByTestId('book-slot').first()
      const hasSlot = await slot.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)
      if (hasSlot) {
        await slot.click()
        booked = true
        break
      }
    }
    expect(booked, 'expected at least one open day with a free slot this week').toBeTruthy()

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
})
