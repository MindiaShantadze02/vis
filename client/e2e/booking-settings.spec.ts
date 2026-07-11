import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Booking-page settings — the customer-facing page controls (colour theme,
 * reviews toggle, shareable link/embed). Non-persisting: Save is never clicked,
 * so the seeded org's theme/reviews flag are left unchanged.
 */
test.describe('Settings — Booking page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/booking')
    await expect(page.getByTestId('booking-save')).toBeVisible()
  })

  test('shows the shareable link, embed code, and a preview link', async ({ page }) => {
    await expect(page.getByText(/vis\.ge\/book\//).first()).toBeVisible()
    await expect(page.getByText('embed.js')).toBeVisible()
    // "View page" opens the public booking page in a new tab.
    await expect(page.getByRole('link', { name: /გვერდის ნახვა/ })).toBeVisible()
  })

  test('a custom booking colour is accepted and reflected in the swatch', async ({ page }) => {
    await page.getByTestId('booking-custom-color').fill('#123456')
    // The custom tile shows the chosen hex (uppercased) once selected.
    await expect(page.getByText('#123456', { exact: false })).toBeVisible()
    // Not saved — booking theme is left unchanged on the seed.
  })

  test('the reviews toggle is present and switchable', async ({ page }) => {
    const toggle = page.getByTestId('reviews-enabled-toggle').locator('input')
    await expect(toggle).toBeChecked() // seed default is on
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    // Not saved — the org's reviews flag is left unchanged.
  })

  test('the require-approval toggle is present, off by default, and switchable', async ({ page }) => {
    const toggle = page.getByTestId('require-approval-toggle').locator('input')
    // Auto-approve is the default (075): the seed org rests with approval off.
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await expect(toggle).toBeChecked()
    // Not saved — the org keeps auto-approving; the pending workflow itself is
    // exercised (via setRequireApproval) in appointment-status/calendar specs.
  })
})
