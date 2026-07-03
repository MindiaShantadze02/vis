import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Working-hours settings. Decision coverage of the save-time validation
 * (dayScheduleIssue → endBeforeStart) and Boundary Value Analysis of the
 * advance-booking window (1..730). The invalid cases return before any DB write,
 * so they don't mutate the seed. The override add/delete is a self-cleaning
 * state cycle.
 */
test.describe('Settings — Working hours', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/hours')
    await expect(page.getByTestId('wh-save')).toBeVisible()
  })

  test('save is rejected when a day closes before it opens (endBeforeStart)', async ({ page }) => {
    // Monday is open on the seed org, so its time fields are editable.
    const open = page.getByTestId('wh-monday-open')
    await expect(open).toBeVisible()
    await open.fill('18:00')
    await page.getByTestId('wh-monday-close').fill('09:00')

    await page.getByTestId('wh-save').click()

    // Validation blocks the save (nothing persisted) and surfaces the reason.
    await expect(page.getByTestId('wh-error')).toBeVisible()
    await expect(page.getByTestId('wh-error')).toContainText('დასრულების დრო')
  })

  test('advance-booking window rejects out-of-range values (BVA 0 and 731)', async ({ page }) => {
    const max = page.getByTestId('wh-max-advance')

    // Below the lower bound (0 < 1).
    await max.fill('0')
    await page.getByTestId('wh-save').click()
    await expect(page.getByTestId('wh-error')).toBeVisible()
    await expect(page.getByTestId('wh-error')).toContainText('1–730')

    // Above the upper bound (731 > 730).
    await max.fill('731')
    await page.getByTestId('wh-save').click()
    await expect(page.getByTestId('wh-error')).toBeVisible()
    await expect(page.getByTestId('wh-error')).toContainText('1–730')
    // Nothing was persisted — handleSave returns before the DB write on error.
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
