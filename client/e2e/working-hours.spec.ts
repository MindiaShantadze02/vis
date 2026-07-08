import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Working-hours settings — the self-cleaning override add/delete state cycle.
 * Save-time validation (dayScheduleIssue decision table) and the
 * advance-booking-window BVA are data-driven now — see
 * e2e/data/working-hours.json + e2e/data-driven/working-hours.spec.ts.
 */
test.describe('Settings — Working hours', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/hours')
    await expect(page.getByTestId('wh-save')).toBeVisible()
  })

  test('add then delete a per-day override (self-clean state cycle)', async ({ page }) => {
    const rows = page.getByTestId('wh-override-row')
    const before = await rows.count()

    // Open the add-override dialog and pick a far-future, unique date to avoid
    // colliding with any existing override (upsert is keyed on org_id + date).
    await page.getByTestId('wh-override-add').click()
    const future = new Date(Date.now() + (400 + (Date.now() % 300)) * 86_400_000)
    const iso = future.toISOString().slice(0, 10)
    await page.getByTestId('wh-ov-date').fill(iso)
    await page.getByTestId('wh-ov-save').click()

    await expect(rows).toHaveCount(before + 1)

    // Delete the one we just added (far-future date sorts last) and confirm.
    await rows.last().getByTestId('wh-override-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(rows).toHaveCount(before)
  })
})
