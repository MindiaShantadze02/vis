import { test, expect } from '@playwright/test'
import { login, fillStable } from './helpers'

/**
 * Profile settings — validation gating, Error-Guessing on the logo upload, the
 * delete-account confirm-word guard, and the custom booking colour. All cases
 * are non-persisting (Save is never clicked with changed values; oversized/
 * invalid uploads are rejected before hitting storage; the delete is never
 * confirmed), so the seeded org is left untouched.
 */
test.describe('Settings — Profile', () => {
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

  test('delete-account is gated on typing the confirmation word (never confirmed)', async ({ page }) => {
    await page.getByTestId('delete-account-btn').click()
    const confirm = page.getByTestId('delete-account-confirm')
    await expect(confirm).toBeVisible()
    await expect(confirm).toBeDisabled()

    // Wrong word keeps it disabled.
    await fillStable(page.getByTestId('delete-confirm-input'), 'delete')
    await expect(confirm).toBeDisabled()

    // The exact confirmation word (case-insensitive) enables it — but we DO NOT
    // click it, so the seeded owner is never deleted.
    await fillStable(page.getByTestId('delete-confirm-input'), 'წაშლა')
    await expect(confirm).toBeEnabled()

    // Abort — close the dialog without deleting.
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
  })

  test('a custom booking colour is accepted and reflected in the swatch', async ({ page }) => {
    await page.getByTestId('booking-custom-color').fill('#123456')
    // The custom tile shows the chosen hex (uppercased) once selected.
    await expect(page.getByText('#123456', { exact: false })).toBeVisible()
    // Not saved — booking theme is left unchanged on the seed.
  })
})
