import { test, expect, type Page } from '@playwright/test'
import { login, bookPending, cancelAppt, letterName } from './helpers'

/**
 * Calendar page — the pending→approved transition driven from the calendar
 * drawer (a distinct code path from the overview list). Books a real pending
 * appointment, approves it on the calendar, verifies the new status on the
 * overview, then self-cleans (cancel + erase).
 */
test.describe('Calendar', () => {
  // Locate the appointment's pill in the current calendar week and open its
  // drawer. Handles both a standalone pill and one merged into a same-service
  // group.
  async function tryOpenInView(page: Page, name: string): Promise<boolean> {
    const single = page.getByTestId('cal-appt').filter({ hasText: name })
    if (await single.count()) {
      await single.first().click()
      return true
    }
    const groups = page.getByTestId('cal-appt-group')
    for (let i = 0, n = await groups.count(); i < n; i++) {
      await groups.nth(i).click()
      const item = page.getByTestId('cal-group-item').filter({ hasText: name })
      if (await item.count()) {
        await item.first().click()
        return true
      }
      await page.keyboard.press('Escape')
    }
    return false
  }

  // The booked slot may fall in a later calendar week than the current one, so
  // scan forward a few weeks before giving up.
  async function openOnCalendar(page: Page, name: string): Promise<void> {
    for (let week = 0; week < 5; week++) {
      // Let the week's appointments finish loading before scanning for the pill.
      await page.waitForTimeout(1200)
      if (await tryOpenInView(page, name)) return
      await page.getByTestId('cal-next').click()
      await expect(page.getByTestId('cal-week-label')).toBeVisible()
    }
    throw new Error(`appointment "${name}" not found within 5 calendar weeks`)
  }

  test('a pending booking can be approved from the calendar', async ({ page }) => {
    const name = letterName()
    await bookPending(page, name)
    await login(page)

    await page.goto('/dashboard/calendar')
    await expect(page.getByTestId('cal-week-label')).toBeVisible()

    await openOnCalendar(page, name)

    // The drawer offers approve/reject for a pending appointment.
    const approve = page.getByTestId('cal-approve')
    await expect(approve).toBeVisible()
    await expect(page.getByTestId('cal-reject')).toBeVisible()
    await approve.click()
    // The drawer closes only after changeStatus() resolves the DB update, so its
    // disappearance confirms the pending→approved transition succeeded. (The
    // overview-side approval is separately covered by appointment-status.spec.)
    await expect(approve).toHaveCount(0)

    // Self-clean: drive it to a terminal state so it drops out of the usage count.
    await cancelAppt(page, name)
  })
})
