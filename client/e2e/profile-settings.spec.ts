import { test, expect } from '@playwright/test'
import { login, fillStable } from './helpers'

/**
 * Business settings (formerly "Profile") — business identity only: name, phone,
 * logo. Booking-page appearance/reviews live in booking-settings.spec; account
 * deletion in account-settings.spec. All cases here are non-persisting (Save is
 * never clicked with changed values; oversized/invalid uploads are rejected
 * before hitting storage), so the seeded org is left untouched.
 */
test.describe('Settings — Business', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
  })

  test('save is gated on a valid business name and contact phone', async ({ page }) => {
    const save = page.getByTestId('profile-save')
    // Seed loads valid → enabled.
    await expect(save).toBeEnabled()

    // Name below the 2-char minimum → disabled.
    await fillStable(page.getByTestId('profile-name'), 'A')
    await expect(save).toBeDisabled()

    // Valid name again, then clear the required phone → disabled.
    await fillStable(page.getByTestId('profile-name'), 'Valid Studio')
    await fillStable(page.getByTestId('profile-phone'), '')
    await expect(save).toBeDisabled()

    // Invalid phone (too short) → still disabled.
    await fillStable(page.getByTestId('profile-phone'), '123')
    await expect(save).toBeDisabled()
    // Never saved — seed profile unchanged.
  })

  test('logo upload rejects an oversized image (BVA > 2 MB) and a non-image', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')

    // Just over the 2 MB (MAX_LOGO_BYTES) ceiling — rejected before upload.
    await fileInput.setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 1),
    })
    await expect(page.getByTestId('profile-error')).toBeVisible()
    await expect(page.getByTestId('profile-error')).toContainText('ძალიან დიდია')

    // A non-image file is rejected with the invalid-image message.
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    })
    await expect(page.getByTestId('profile-error')).toContainText('სურათის ფაილი')
  })
})
