import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/profile.json' with { type: 'json' }

/**
 * Data-driven business-profile validation (cases in e2e/data/profile.json).
 * The save button is never disabled for validation, so invalid rows are
 * submitted and must flag the offending field inline (aria-invalid);
 * handleSave validates before any DB write, so no invalid row ever persists
 * (and the "field flagged" assertion guards that). Valid rows are only
 * asserted enabled — clicking one would really overwrite the seed org — so
 * the seed stays untouched. The profile-error Alert remains for server and
 * logo-upload errors.
 */
test.describe('Data-driven — Business profile', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
  })

  test('save validation across name/phone partitions', async ({ page }) => {
    const save = page.getByTestId('profile-save')
    // Seed loads valid → enabled.
    await expect(save).toBeEnabled()

    for (const c of data.gatingCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const f = c.fields as { name?: string; phone?: string }
        if (f.name !== undefined) await fillStable(page.getByTestId('profile-name'), f.name)
        if (f.phone !== undefined) await fillStable(page.getByTestId('profile-phone'), f.phone)
        await expect(save).toBeEnabled()
        if (!c.valid) {
          await save.click()
          await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
        }
      })
    }
    // Valid rows are never clicked — seed profile unchanged.
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
