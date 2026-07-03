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

  test('save gating: duration, capacity, price boundaries + online link (BVA + pairwise)', async ({ page }) => {
    await page.getByTestId('service-add').click()
    const save = page.getByTestId('service-save')
    await fillStable(page.getByTestId('service-name'), 'Boundary Svc')
    await fillStable(page.getByTestId('service-price'), '10')
    await fillStable(page.getByTestId('service-max-per-slot'), '1')

    // Duration BVA around (0, 1440].
    await fillStable(page.getByTestId('service-duration'), '0')       // below lower bound
    await expect(save).toBeDisabled()
    await fillStable(page.getByTestId('service-duration'), '1')       // lower boundary
    await expect(save).toBeEnabled()
    await fillStable(page.getByTestId('service-duration'), '1440')    // upper boundary
    await expect(save).toBeEnabled()
    await fillStable(page.getByTestId('service-duration'), '1441')    // above upper bound
    await expect(save).toBeDisabled()
    await fillStable(page.getByTestId('service-duration'), '60')      // back to valid

    // Capacity (max_per_slot) BVA around the ≥1 rule.
    await fillStable(page.getByTestId('service-max-per-slot'), '0')
    await expect(save).toBeDisabled()
    await fillStable(page.getByTestId('service-max-per-slot'), '1')
    await expect(save).toBeEnabled()

    // Price BVA: 0 is allowed; just over MAX_PRICE is rejected.
    await fillStable(page.getByTestId('service-price'), '0')
    await expect(save).toBeEnabled()
    await fillStable(page.getByTestId('service-price'), '100000000')  // > 99999999.99
    await expect(save).toBeDisabled()
    await fillStable(page.getByTestId('service-price'), '10')

    // Pairwise: {online} × {meeting link empty / invalid / valid}.
    await page.getByRole('button', { name: 'ონლაინ', exact: true }).click() // switch to online
    // Meeting link field appears only for online services.
    const meetingLink = page.locator('input[inputmode="url"]')
    await expect(save).toBeDisabled()                                  // online + empty link
    await fillStable(meetingLink, 'not-a-url')
    await expect(save).toBeDisabled()                                  // online + invalid link
    await fillStable(meetingLink, 'https://meet.example.com/room')
    await expect(save).toBeEnabled()                                   // online + valid link

    // Back to in-person → the meeting link no longer matters.
    await page.getByRole('button', { name: 'ადგილზე', exact: true }).click()
    await expect(save).toBeEnabled()
    // Never saved — no data created.
  })
})
