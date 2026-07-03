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

    // Phase 1: send is gated on a valid phone.
    const send = page.getByTestId('forgot-send')
    await expect(send).toBeDisabled()
    await fillStable(page.getByTestId('forgot-phone'), uniquePhone())
    await expect(send).toBeEnabled()
    await send.click()

    // Phase 2: the reset step appears the same whether or not the phone exists
    // (neutral — never reveals account existence).
    await expect(page.getByTestId('forgot-code')).toBeVisible()
    await expect(page.getByTestId('forgot-submit')).toBeVisible()
    await expect(page.getByText('თუ ამ ნომერზე ანგარიში არსებობს')).toBeVisible()
  })

  test('submit is gated until code is 6 digits and passwords match (≥10)', async ({ page }) => {
    await page.goto('/forgot-password')
    await fillStable(page.getByTestId('forgot-phone'), uniquePhone())
    await page.getByTestId('forgot-send').click()
    await expect(page.getByTestId('forgot-code')).toBeVisible()

    const submit = page.getByTestId('forgot-submit')
    await expect(submit).toBeDisabled()

    // Code present but passwords too short (BVA: 9 < 10).
    await fillStable(page.getByTestId('forgot-code'), '123456')
    await fillStable(page.getByTestId('forgot-password'), '123456789')
    await fillStable(page.getByTestId('forgot-confirm-password'), '123456789')
    await expect(submit).toBeDisabled()

    // Passwords at the boundary (10) but mismatched.
    await fillStable(page.getByTestId('forgot-password'), '1234567890')
    await fillStable(page.getByTestId('forgot-confirm-password'), '1234567899')
    await expect(submit).toBeDisabled()

    // Valid code + matching 10-char passwords → enabled.
    await fillStable(page.getByTestId('forgot-confirm-password'), '1234567890')
    await expect(submit).toBeEnabled()

    // Non-numeric characters are stripped from the code; too-short code disables again.
    // (Plain fill, not fillStable — the input transforms the value, so what we type
    // isn't what sticks.)
    await page.getByTestId('forgot-code').fill('12ab')
    await expect(page.getByTestId('forgot-code')).toHaveValue('12')
    await expect(submit).toBeDisabled()
  })

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
