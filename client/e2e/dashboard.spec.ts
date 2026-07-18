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

  test('on mobile the calendar is a single-day timeline with a week strip', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dashboard/calendar')

    // The week strip has one tappable cell per weekday, plus a focused-day title.
    await expect(page.getByTestId('cal-strip-day')).toHaveCount(7)
    const dayTitle = page.getByTestId('cal-day-title')
    await expect(dayTitle).toBeVisible()

    // Tapping the first (Sunday) then last (Saturday) cell focuses two distinct
    // days, so their titles must differ — proving strip selection works.
    await page.getByTestId('cal-strip-day').first().click()
    const sunTitle = await dayTitle.innerText()
    await page.getByTestId('cal-strip-day').last().click()
    const satTitle = await dayTitle.innerText()
    expect(sunTitle).not.toBe(satTitle)

    // The next arrow steps forward one day.
    await page.getByTestId('cal-next').click()
    await expect(dayTitle).not.toHaveText(satTitle)
  })

  test('the appointments list exposes service, payment, and quick-date filters', async ({ page }) => {
    // Controls are present…
    await expect(page.getByTestId('appt-service-filter')).toBeVisible()
    await expect(page.getByTestId('appt-payment-filter')).toBeVisible()
    await expect(page.getByTestId('preset-today')).toBeVisible()
    await expect(page.getByTestId('preset-upcoming')).toBeVisible()
    // …and with nothing filtering yet, there's no reset affordance.
    await expect(page.getByTestId('reset-filters')).toHaveCount(0)

    // A quick-date preset filters the list and reveals the reset control.
    await page.getByTestId('preset-today').click()
    await expect(page.getByTestId('reset-filters')).toBeVisible()

    // Reset clears everything and the reset control disappears again.
    await page.getByTestId('reset-filters').click()
    await expect(page.getByTestId('reset-filters')).toHaveCount(0)
  })

  test('the payment-status filter narrows the list and can be reset', async ({ page }) => {
    // Pick a payment status via the MUI select; the list re-queries server-side.
    await page.getByTestId('appt-payment-filter').click()
    await page.getByRole('option', { name: 'გადახდილი', exact: true }).click()
    await expect(page.getByTestId('reset-filters')).toBeVisible()
    // The list container still renders (rows or the "not found" empty state) —
    // i.e. the filtered query resolved without error.
    await expect(page.getByTestId('appt-row').first().or(page.getByText('ჯავშნები ვერ მოიძებნა')))
      .toBeVisible({ timeout: 20_000 })
    await page.getByTestId('reset-filters').click()
    await expect(page.getByTestId('reset-filters')).toHaveCount(0)
  })

  test('on mobile the filters collapse behind a button that opens a dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()

    // The attribute/date controls are no longer inline — they're behind a button.
    await expect(page.getByTestId('appt-service-filter')).toHaveCount(0)
    const filtersBtn = page.getByTestId('appt-filters-btn')
    await expect(filtersBtn).toBeVisible()

    // Opening the dialog reveals the collapsed filters; a preset filters the list.
    await filtersBtn.click()
    await expect(page.getByTestId('appt-service-filter')).toBeVisible()
    await page.getByTestId('preset-today').click()
    await page.getByTestId('appt-filters-done').click()

    // Back on the list, the button now shows an active-filter badge (the badge span
    // is a sibling of the button inside the MUI Badge root); reset clears it.
    const badge = page.locator('.MuiBadge-root:has([data-testid="appt-filters-btn"]) .MuiBadge-badge')
    await expect(badge).toHaveText('1')
    await filtersBtn.click()
    await page.getByTestId('reset-filters').click()
    await page.getByTestId('appt-filters-done').click()
    await expect(badge).not.toBeVisible()
  })

  // --- edge cases ---

  test('add-appointment flags missing fields inline on save instead of disabling it', async ({ page }) => {
    await page.getByTestId('appt-add-btn').click()
    const dialog = page.getByTestId('add-appt-dialog')
    const save = page.getByTestId('add-appt-save')
    // Enabled by design; clicking an incomplete form flags the invalid fields
    // inline and keeps the dialog open (nothing is created).
    await expect(save).toBeEnabled()
    await save.click()
    await expect(dialog.locator('[aria-invalid="true"]').first()).toBeVisible()
    await expect(dialog).toBeVisible()

    // A name with digits is rejected too (isValidPersonName), still no create.
    await page.getByTestId('add-appt-first-name').fill('Ana2')
    await page.getByTestId('add-appt-phone').fill('599112233')
    await save.click()
    await expect(page.getByTestId('add-appt-first-name')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog).toBeVisible()
    await page.getByTestId('add-appt-cancel').click()
  })
})
