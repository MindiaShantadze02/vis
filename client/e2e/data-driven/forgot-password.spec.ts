import { test, expect } from '@playwright/test'
import { fillStable, uniquePhone } from '../helpers'
import data from '../data/forgot-password.json' with { type: 'json' }

/**
 * Data-driven validation of the forgot-password flow (cases in
 * e2e/data/forgot-password.json). Buttons are never disabled for validation:
 * invalid rows are submitted and must flag the offending field inline
 * (aria-invalid) while staying on the step (the handlers validate before any
 * OTP/reset network call; the forgot-error Alert is reserved for server
 * errors). Every run uses a throwaway phone, and valid rows are never
 * clicked, so no reset can ever succeed or touch the seeded owner.
 */
test.describe('Data-driven — Forgot password', () => {
  test('send validation across phone partitions', async ({ page }) => {
    await page.goto('/forgot-password')
    const phone = page.getByTestId('forgot-phone')
    const send = page.getByTestId('forgot-send')
    await expect(send).toBeVisible()

    for (const c of data.sendCases) {
      const value = c.fields.phone === '__UNIQUE_PHONE__' ? uniquePhone() : c.fields.phone
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, value)
        await expect(send).toBeEnabled()
        if (!c.valid) {
          // Invalid phone is flagged inline on click; no OTP request goes out.
          await send.click()
          await expect(phone).toHaveAttribute('aria-invalid', 'true')
          await expect(page.getByTestId('forgot-code')).toHaveCount(0) // never advanced
        }
      })
    }
    // Valid phone is never clicked here — no OTP request goes out.
  })

  test('reset-step validation across code/password partitions', async ({ page }) => {
    await page.goto('/forgot-password')
    await fillStable(page.getByTestId('forgot-phone'), uniquePhone())
    await page.getByTestId('forgot-send').click()
    await expect(page.getByTestId('forgot-code')).toBeVisible()

    const code = page.getByTestId('forgot-code')
    const password = page.getByTestId('forgot-password')
    const confirm = page.getByTestId('forgot-confirm-password')
    const submit = page.getByTestId('forgot-submit')

    for (const c of data.resetCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(code, c.fields.code)
        await fillStable(password, c.fields.password)
        await fillStable(confirm, c.fields.confirm)
        await expect(submit).toBeEnabled()
        if (!c.valid) {
          // Invalid code/password is flagged inline before the reset call runs.
          await submit.click()
          await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
        }
      })
    }

    for (const c of data.codeInputCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        // Plain fill — the input transform (digit strip + 6-digit clamp) means
        // what we type isn't what sticks.
        await code.fill('')
        await code.fill(c.type)
        await expect(code).toHaveValue(c.expectValue)
      })
    }
    // The valid reset row is never clicked — nothing is reset.
  })
})
