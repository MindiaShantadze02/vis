import { test, expect } from '@playwright/test'
import { login, fillStable, readSupabaseEnv, SEED } from './helpers'

/**
 * Account settings — the delete-account danger zone and the OTP-gated password
 * change. Both are tested WITHOUT ever completing the destructive act: the
 * seeded owner is never deleted and its password is never changed. (The real
 * delete path is exercised safely by onboarding.spec on a throwaway account.)
 * The buttons are not disabled for validation: bad input is reported on click.
 *
 * The password change cannot be driven to completion by a test at all —
 * reset-password carries NO '000000' bypass (unlike verify-booking-otp), and the
 * real code only exists in the SMS. So these cover everything up to the code and
 * then prove the password did NOT change. Same limit as forgot-password.spec.
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

  test('a password change is gated on an SMS code to the account phone', async ({ page }) => {
    const send = page.getByTestId('account-change-password')
    await expect(send).toBeVisible()

    // A bad password never reaches the code step — no SMS is spent on input
    // that would be rejected anyway.
    await fillStable(page.getByTestId('account-new-password'), 'short')
    await send.click()
    await expect(page.getByTestId('account-new-password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('account-password-code')).toHaveCount(0)

    // Mismatched confirmation: same.
    await fillStable(page.getByTestId('account-new-password'), 'newpassword123')
    await fillStable(page.getByTestId('account-confirm-password'), 'newpassword124')
    await send.click()
    await expect(page.getByTestId('account-confirm-password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('account-password-code')).toHaveCount(0)

    // A valid pair moves to the code step, which names the phone it went to.
    await fillStable(page.getByTestId('account-confirm-password'), 'newpassword123')
    await send.click()
    const code = page.getByTestId('account-password-code')
    await expect(code).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('account-code-sent')).toContainText('555')

    // A wrong code is refused and the change does not go through.
    await fillStable(code, '111111')
    await page.getByTestId('account-confirm-password-change').click()
    await expect(page.getByTestId('account-password-error')).toBeVisible({ timeout: 20_000 })
    await expect(code).toBeVisible()

    // Cancel returns to the form with the fields cleared.
    await page.getByRole('button', { name: 'გაუქმება' }).first().click()
    await expect(page.getByTestId('account-new-password')).toHaveValue('')

    // The seed password is untouched — the real proof that nothing changed.
    const { url, anonKey } = readSupabaseEnv()
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ phone: `+995${SEED.phone}`, password: SEED.password }),
    })
    expect(res.ok, 'the seeded owner must still sign in with the ORIGINAL password').toBe(true)
  })
})
