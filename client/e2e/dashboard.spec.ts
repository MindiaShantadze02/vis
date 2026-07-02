import { test, expect } from '@playwright/test'
import { login, SEED } from './helpers'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('overview shows stats and the booking link', async ({ page }) => {
    // Overview stats render via StatStrip (labelled boxes, no per-card testid).
    await expect(page.getByText('შემოსავალი კვირაში')).toBeVisible()
    await expect(page.getByText('დღევანდელი ჯავშნები')).toBeVisible()
    await expect(page.getByText(new RegExp(`vis\\.ge/book/${SEED.slug}`))).toBeVisible()
  })

  test('the add-appointment dialog opens and closes', async ({ page }) => {
    await page.getByTestId('appt-add-btn').click()
    await expect(page.getByTestId('add-appt-dialog')).toBeVisible()
    await page.getByTestId('add-appt-cancel').click()
    await expect(page.getByTestId('add-appt-dialog')).toHaveCount(0)
  })

  test('the calendar page loads with week navigation', async ({ page }) => {
    await page.goto('/dashboard/calendar')
    await expect(page.getByTestId('cal-week-label')).toBeVisible()
    await page.getByTestId('cal-next').click()
    await page.getByTestId('cal-prev').click()
    await expect(page.getByTestId('cal-week-label')).toBeVisible()
  })
})
