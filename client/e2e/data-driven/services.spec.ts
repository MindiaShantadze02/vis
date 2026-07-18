import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/services.json' with { type: 'json' }

const FIELD_TESTIDS: Record<string, string> = {
  name: 'service-name',
  duration: 'service-duration',
  price: 'service-price',
  capacity: 'service-max-per-slot',
}

/**
 * Data-driven validation of the service editor (cases in e2e/data/services.json
 * — BVA on name/duration/price/capacity). Save is never disabled for validation:
 * invalid rows are submitted and must flag the offending field inline
 * (aria-invalid; handleSave validates before any insert/update, so nothing
 * persists). Valid rows are only asserted enabled — clicking one would really
 * create a service — so the dialog is abandoned unsaved. The service-dialog-error
 * Alert remains for server errors. (Meeting links are per-appointment now — see
 * meeting-link.spec.ts — so there's no online × link pairwise here anymore.)
 */
test.describe('Data-driven — Services', () => {
  test('save validation across all field boundaries and partitions', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/services')
    await page.getByTestId('service-add').click()
    const save = page.getByTestId('service-save')
    const dialog = page.getByRole('dialog')

    // Valid base — sanity-check it enables save before iterating.
    for (const [field, value] of Object.entries(data.base)) {
      await fillStable(page.getByTestId(FIELD_TESTIDS[field]), value)
    }
    await expect(save).toBeEnabled()

    for (const c of data.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        for (const [field, value] of Object.entries(c.fields)) {
          await fillStable(page.getByTestId(FIELD_TESTIDS[field]), String(value))
        }

        await expect(save).toBeEnabled()
        if (!c.valid) {
          await save.click()
          await expect(dialog.locator('[aria-invalid="true"]').first()).toBeVisible()
        }

        // Restore the base for everything this case touched.
        for (const field of Object.keys(c.fields)) {
          await fillStable(
            page.getByTestId(FIELD_TESTIDS[field]),
            data.base[field as keyof typeof data.base],
          )
        }
      })
    }
    // Dialog is abandoned unsaved — no service created.
  })
})
