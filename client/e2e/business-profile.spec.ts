import { test, expect } from '@playwright/test'
import { login, fillStable, SEED } from './helpers'

/**
 * Business-info settings — persisting cases. Validation-only partitions (save
 * gating, logo rejection) live in data-driven/profile.spec.ts; this spec covers
 * the address round-trip, restoring the seed's empty address afterwards so no
 * residue is left. The address feeds the booking-confirmation SMS (077), which
 * is server-side and asserted here only as far as the persisted column.
 */
test.describe('Settings — Business info', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
  })

  test('address saves, survives a reload, and can be cleared again', async ({ page }) => {
    const address = 'ე2ე ტესტის მისამართი 42'

    await fillStable(page.getByTestId('profile-address'), address)
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('profile-address')).toHaveValue(address)

    // The public booking page shows the saved address in the branded sidebar,
    // under the contact phone (get_public_org carries it since 078).
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-address')).toContainText(address)

    // Clear it back to the seed state (empty ⇒ stored as NULL).
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
    await fillStable(page.getByTestId('profile-address'), '')
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('profile-address')).toHaveValue('')
  })

  // Merchant legal disclosure (E-Commerce Law Art. 4 / Consumer Law Art. 5): the
  // business email persists and surfaces on the public booking page.
  test('email saves, shows on the booking page, and clears again', async ({ page }) => {
    const email = 'e2e-legal@example.com'

    await fillStable(page.getByTestId('profile-email'), email)
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('profile-email')).toHaveValue(email)

    // Public booking page shows it in the branded sidebar (get_public_org).
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-email')).toContainText(email)

    // Restore the empty seed state (empty ⇒ NULL).
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
    await fillStable(page.getByTestId('profile-email'), '')
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('profile-email')).toHaveValue('')
  })

  test('an invalid email is flagged inline and blocks save', async ({ page }) => {
    await fillStable(page.getByTestId('profile-email'), 'not-an-email')
    await page.getByTestId('profile-save').click()
    // Inline per-field error (no toast); nothing persisted.
    await expect(page.getByTestId('profile-email')).toHaveAttribute('aria-invalid', 'true')
    await fillStable(page.getByTestId('profile-email'), '')
  })
})
