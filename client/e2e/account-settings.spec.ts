import { test, expect } from '@playwright/test'
import { login, fillStable } from './helpers'

/**
 * Account settings — the delete-account danger zone. The confirm-word guard is
 * tested WITHOUT ever confirming, so the seeded owner is never deleted. (The
 * real delete path is exercised safely by onboarding.spec on a throwaway account.)
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
})
