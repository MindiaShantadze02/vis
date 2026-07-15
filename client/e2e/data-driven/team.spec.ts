import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/team.json' with { type: 'json' }

/**
 * Data-driven validation of the team settings dialogs (cases in
 * e2e/data/team.json). The save/send buttons are never disabled for
 * validation: invalid rows are submitted and must flag the field inline while
 * the dialog stays open (the handlers validate before any insert). Valid rows
 * are only asserted enabled — clicking one would really create a member /
 * invitation — so nothing is submitted.
 */
test.describe('Data-driven — Team', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/team')
    await expect(page.getByTestId('add-professional-btn')).toBeVisible()
  })

  test('add-professional validation across name partitions', async ({ page }) => {
    await page.getByTestId('add-professional-btn').click()
    const name = page.getByTestId('professional-name')
    const save = page.getByTestId('professional-save')
    await expect(save).toBeVisible()

    for (const c of data.professionalNameCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(name, c.value)
        await expect(save).toBeEnabled()
        if (!c.valid) {
          await save.click()
          await expect(name).toHaveAttribute('aria-invalid', 'true')
          await expect(save).toBeVisible() // dialog still open — nothing created
        }
      })
    }
    // Valid rows never clicked — nothing created.
  })

  test('invite send validation across phone partitions', async ({ page }) => {
    await page.getByTestId('team-invite-btn').click()
    const phone = page.getByTestId('invite-phone')
    const send = page.getByTestId('invite-send')
    await expect(send).toBeVisible()

    for (const c of data.invitePhoneCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, c.value)
        await expect(send).toBeEnabled()
        if (!c.valid) {
          await send.click()
          await expect(phone).toHaveAttribute('aria-invalid', 'true')
          await expect(send).toBeVisible() // dialog still open — no invitation created
        }
      })
    }
    // Valid rows never clicked — no invitation created.
  })
})
