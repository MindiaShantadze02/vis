import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/team.json' with { type: 'json' }

/**
 * Data-driven gating of the team settings dialogs (cases in e2e/data/team.json).
 * Nothing is submitted — the add/delete-professional and invite/cancel flows in
 * settings-team.spec.ts are the representative submits.
 */
test.describe('Data-driven — Team', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/team')
    await expect(page.getByTestId('add-professional-btn')).toBeVisible()
  })

  test('add-professional save gating across name partitions', async ({ page }) => {
    await page.getByTestId('add-professional-btn').click()
    const name = page.getByTestId('professional-name')
    const save = page.getByTestId('professional-save')
    await expect(save).toBeVisible()

    for (const c of data.professionalNameCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(name, c.value)
        if (c.valid) await expect(save).toBeEnabled()
        else await expect(save).toBeDisabled()
      })
    }
    // Dialog abandoned — nothing created.
  })

  test('invite send gating across phone partitions', async ({ page }) => {
    await page.getByTestId('team-invite-btn').click()
    const phone = page.getByTestId('invite-phone')
    const send = page.getByTestId('invite-send')
    await expect(send).toBeVisible()

    for (const c of data.invitePhoneCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, c.value)
        if (c.valid) await expect(send).toBeEnabled()
        else await expect(send).toBeDisabled()
      })
    }
    // Send never clicked — no invitation created.
  })
})
