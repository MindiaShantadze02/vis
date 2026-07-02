import { test, expect } from '@playwright/test'
import { login, tag, fillStable } from './helpers'

test.describe('Settings — Services', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/services')
    await expect(page.getByTestId('service-add')).toBeVisible()
  })

  test('create, edit, then delete a service', async ({ page }) => {
    const rows = page.getByTestId('service-row')
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

  test('save is disabled for an empty name or an out-of-range price', async ({ page }) => {
    await page.getByTestId('service-add').click()
    const save = page.getByTestId('service-save')
    await expect(save).toBeDisabled()                       // empty name

    await fillStable(page.getByTestId('service-name'), 'Valid Name')
    await fillStable(page.getByTestId('service-duration'), '30')
    await expect(save).toBeEnabled()

    await fillStable(page.getByTestId('service-price'), '999999999')  // over MAX_PRICE
    await expect(save).toBeDisabled()

    await fillStable(page.getByTestId('service-duration'), '0')       // fix price, break duration
    await fillStable(page.getByTestId('service-price'), '10')
    await expect(save).toBeDisabled()
    // Nothing submitted — no data created.
  })
})
