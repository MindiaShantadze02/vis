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

  test('a service marked recurring-by-default persists and pre-fills the add-appointment repeat', async ({ page }) => {
    const rows = page.getByTestId('service-row')
    await expect(rows.first()).toBeVisible()
    const name = tag('E2E Recurring Svc')

    // Create with recurring-by-default on (weekly, 5 occurrences).
    await page.getByTestId('service-add').click()
    await page.getByTestId('service-name').fill(name)
    await page.getByTestId('service-duration').fill('30')
    await page.getByTestId('service-price').fill('25')
    await page.getByTestId('service-recurring-default').click()
    await expect(page.getByTestId('service-cadence-weekly')).toBeVisible()
    await page.getByTestId('service-recurring-count').fill('5')
    await page.getByTestId('service-save').click()

    const row = rows.filter({ hasText: name })
    await expect(row).toBeVisible()

    // Reopen → the recurrence config persisted.
    await row.getByTestId('service-edit').click()
    await expect(page.getByTestId('service-recurring-default').locator('input')).toBeChecked()
    await expect(page.getByTestId('service-recurring-count')).toHaveValue('5')
    await page.keyboard.press('Escape') // close the drawer

    // Add-appointment dialog (dashboard): picking this service pre-enables the
    // repeat options from the service's defaults (cadence + occurrence count).
    await page.goto('/dashboard')
    await page.getByTestId('appt-add-btn').click()
    await expect(page.getByTestId('add-appt-dialog')).toBeVisible()
    await page.getByTestId('add-appt-service').click()
    await page.getByRole('option', { name: new RegExp(name) }).click()
    await expect(page.getByTestId('cadence-weekly')).toBeVisible()
    await expect(page.getByTestId('occ-count')).toHaveValue('5')
    await page.getByTestId('add-appt-cancel').click()

    // Self-clean: delete the service.
    await page.goto('/dashboard/settings/services')
    const delRow = page.getByTestId('service-row').filter({ hasText: name })
    await delRow.getByTestId('service-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByText(name)).toHaveCount(0)
  })

  // Save-gating boundaries (name/duration/price/capacity) are data-driven now
  // — see e2e/data/services.json + e2e/data-driven/services.spec.ts.
})
