import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/profile.json' with { type: 'json' }

/**
 * Data-driven business-profile validation (cases in e2e/data/profile.json).
 * Save is never clicked with changed values and invalid logos are rejected
 * before hitting storage, so the seeded org is left untouched. The exact-2MB
 * ACCEPTED logo boundary is asserted logically in consistency.spec.ts (an e2e
 * upload would really replace the seed logo).
 */
test.describe('Data-driven — Business profile', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
  })

  test('save gating across name/phone partitions', async ({ page }) => {
    const save = page.getByTestId('profile-save')
    // Seed loads valid → enabled.
    await expect(save).toBeEnabled()

    for (const c of data.gatingCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const f = c.fields as { name?: string; phone?: string }
        if (f.name !== undefined) await fillStable(page.getByTestId('profile-name'), f.name)
        if (f.phone !== undefined) await fillStable(page.getByTestId('profile-phone'), f.phone)
        if (c.valid) await expect(save).toBeEnabled()
        else await expect(save).toBeDisabled()
      })
    }
    // Never saved — seed profile unchanged.
  })

  test('logo upload rejection partitions', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')

    for (const c of data.logoCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fileInput.setInputFiles({
          name: c.filename,
          mimeType: c.mime,
          buffer: Buffer.alloc(c.bytes, 1),
        })
        await expect(page.getByTestId('profile-error')).toBeVisible()
        await expect(page.getByTestId('profile-error')).toContainText(c.error)
      })
    }
  })
})
