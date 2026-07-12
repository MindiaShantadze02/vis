import { test, expect } from '@playwright/test'
import { uniquePhone, fillStable } from './helpers'

/**
 * Forgot-password reset flow. State-Transition (phase 'phone' → 'reset') plus
 * Error-Guessing (wrong code, resend cooldown, neutral messaging) and BVA on the
 * submit gating.
 *
 * IMPORTANT: every test uses a throwaway (non-existent) phone, so a reset can
 * never succeed and can never alter the seeded owner's password. We assert the
 * failure/gating behaviour, never a successful password change.
 */
test.describe('Forgot password', () => {
  test('phone → reset transition with neutral messaging (no account leak)', async ({ page }) => {
    await page.goto('/forgot-password')

    // Phase 1: send is always enabled; an invalid phone is reported on click.
    // A valid throwaway phone advances to the reset step.
    const send = page.getByTestId('forgot-send')
    await expect(send).toBeEnabled()
    await fillStable(page.getByTestId('forgot-phone'), uniquePhone())
    await send.click()

    // Phase 2: the reset step appears the same whether or not the phone exists
    // (neutral — never reveals account existence).
    await expect(page.getByTestId('forgot-code')).toBeVisible()
    await expect(page.getByTestId('forgot-submit')).toBeVisible()
    await expect(page.getByText('თუ ამ ნომერზე ანგარიში არსებობს')).toBeVisible()
  })

  // Submit gating (code length / password BVA / mismatch / digit-strip) is
  // data-driven now — see e2e/data/forgot-password.json +
  // e2e/data-driven/forgot-password.spec.ts.

  test('a wrong code is rejected and stays on the reset step', async ({ page }) => {
    await page.goto('/forgot-password')
    await fillStable(page.getByTestId('forgot-phone'), uniquePhone())
    await page.getByTestId('forgot-send').click()
    await expect(page.getByTestId('forgot-code')).toBeVisible()

    await fillStable(page.getByTestId('forgot-code'), '111111')
    await fillStable(page.getByTestId('forgot-password'), 'newpassword123')
    await fillStable(page.getByTestId('forgot-confirm-password'), 'newpassword123')
    await page.getByTestId('forgot-submit').click()

    // Reset fails (no such account / wrong code) — error shown, still on the form.
    await expect(page.getByTestId('forgot-error')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('forgot-submit')).toBeVisible()
    await expect(page).not.toHaveURL(/\/dashboard/)
  })

  test('resend is on cooldown immediately after sending the code', async ({ page }) => {
    await page.goto('/forgot-password')
    await fillStable(page.getByTestId('forgot-phone'), uniquePhone())
    await page.getByTestId('forgot-send').click()
    await expect(page.getByTestId('forgot-code')).toBeVisible()

    // The resend link is disabled and shows a countdown right after sending.
    await expect(page.getByRole('button', { name: /ხელახლა გაგზავნა \(\d+\)/ })).toBeVisible()
  })
})
