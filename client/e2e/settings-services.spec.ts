import { test, expect } from '@playwright/test'
import { login, tag } from './helpers'

test.describe('Settings — Services', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/services')
    await expect(page.getByTestId('service-add')).toBeVisible()
  })

  test('create, edit, then delete a service', async ({ page }) => {
    const rows = page.getByTestId('service-row')
    // Wait for the list to load before counting — the seeded "Consultation"
    // service is always present, so counting before it renders would capture 0
    // and make the +1 assertion below flaky (and leave a residual service).
    await expect(rows.first()).toBeVisible()
    const before = await rows.count()

    // Create
    const name = tag('E2E Service')
    await page.getByTestId('service-add').click()
    await page.getByTestId('service-name').fill(name)
    await page.getByTestId('service-duration').fill('30')
    await page.getByTestId('service-price').fill('40')
    await page.getByTestId('service-save').click()
    await expect(rows).toHaveCount(before + 1)
    const row = rows.filter({ hasText: name })
    await expect(row).toBeVisible()

    // Edit — rename it
    const renamed = `${name} (edited)`
    await row.getByTestId('service-edit').click()
    await page.getByTestId('service-name').fill(renamed)
    await page.getByTestId('service-save').click()
    await expect(rows.filter({ hasText: renamed })).toBeVisible()

    // Delete — confirm dialog, then it's gone (self-clean)
    await rows.filter({ hasText: renamed }).getByTestId('service-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(rows).toHaveCount(before)
    await expect(page.getByText(renamed)).toHaveCount(0)
  })

  // Save-gating boundaries (name/duration/price/capacity) are data-driven now
  // — see e2e/data/services.json + e2e/data-driven/services.spec.ts.
})
