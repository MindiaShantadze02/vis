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

  // --- edge cases ---

  test('add-appointment save stays disabled for an incomplete or invalid form', async ({ page }) => {
    await page.getByTestId('appt-add-btn').click()
    const save = page.getByTestId('add-appt-save')
    await expect(save).toBeDisabled()                              // nothing filled

    // A name with digits + a valid phone still isn't enough (no service/slot),
    // and the name itself is invalid (isValidPersonName rejects digits).
    await page.getByTestId('add-appt-first-name').fill('Ana2')
    await page.getByTestId('add-appt-phone').fill('599112233')
    await expect(save).toBeDisabled()
    await page.getByTestId('add-appt-cancel').click()
  })
})
