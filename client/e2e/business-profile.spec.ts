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
})
