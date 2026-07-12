import { test, expect } from '@playwright/test'
import { login, fillStable } from './helpers'

/**
 * Account settings — the delete-account danger zone. The confirm-word guard is
 * tested WITHOUT ever confirming, so the seeded owner is never deleted. (The
 * real delete path is exercised safely by onboarding.spec on a throwaway account.)
 * The button is no longer disabled for validation: a wrong word is reported on
 * click (the input turns invalid) and never triggers the delete.
 */
test.describe('Settings — Account', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/account')
    await expect(page.getByTestId('delete-account-btn')).toBeVisible()
  })

  test('delete-account is gated on typing the confirmation word (never confirmed)', async ({ page }) => {
    await page.getByTestId('delete-account-btn').click()
    const confirm = page.getByTestId('delete-account-confirm')
    const input = page.getByTestId('delete-confirm-input')
    await expect(confirm).toBeVisible()
    // Enabled by design — the word is checked on click, not via disabling.
    await expect(confirm).toBeEnabled()

    // Empty word: clicking flags the input and does NOT delete (dialog stays).
    await confirm.click()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(confirm).toBeVisible()

    // Wrong word: same — flagged, no delete.
    await fillStable(input, 'delete')
    await confirm.click()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(confirm).toBeVisible()

    // The exact confirmation word (case-insensitive) clears the error — but we
    // DO NOT click confirm, so the seeded owner is never deleted.
    await fillStable(input, 'წაშლა')
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')

    // Abort — close the dialog without deleting.
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
  })
})
