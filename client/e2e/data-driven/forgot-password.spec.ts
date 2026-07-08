import { test, expect } from '@playwright/test'
import { fillStable, uniquePhone } from '../helpers'
import data from '../data/forgot-password.json' with { type: 'json' }

/**
 * Data-driven gating of the forgot-password flow (cases in
 * e2e/data/forgot-password.json). Every run uses a throwaway phone, so a reset
 * can never succeed or touch the seeded owner; forgot-submit is never clicked.
 * The flow itself (transition, wrong code, cooldown) stays in
 * forgot-password.spec.ts.
 */
test.describe('Data-driven — Forgot password', () => {
  test('send gating across phone partitions', async ({ page }) => {
    await page.goto('/forgot-password')
    const phone = page.getByTestId('forgot-phone')
    const send = page.getByTestId('forgot-send')
    await expect(send).toBeVisible()

    for (const c of data.sendCases) {
      const value = c.fields.phone === '__UNIQUE_PHONE__' ? uniquePhone() : c.fields.phone
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, value)
        if (c.valid) await expect(send).toBeEnabled()
        else await expect(send).toBeDisabled()
      })
    }
    // Send is never clicked here — no OTP request goes out.
  })

  test('reset-step gating across code/password partitions', async ({ page }) => {
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
        if (c.valid) await expect(submit).toBeEnabled()
        else await expect(submit).toBeDisabled()
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
    // Submit is never clicked — nothing is reset.
  })
})
