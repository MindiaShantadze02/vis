import { test, expect, type Page } from '@playwright/test'
import { login, seedUpcomingAppointment, cancelAppt, letterName } from './helpers'

/**
 * Calendar page — finding a booking on the week grid and opening its detail
 * drawer (a distinct code path from the overview list, including the merged
 * same-service group pill). Seeds a real appointment, opens it on the calendar,
 * then self-cleans (cancel).
 *
 * The calendar's approve/reject buttons went with the pending-approval workflow
 * (2026-08-14); the drawer is read-only apart from staff reassignment.
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
      // Wait the drawer fully out, or its backdrop eats the next pill's click.
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
    }
    return false
  }

  // The grid swaps in a spinner while a week's appointments load. Waiting for it
  // to clear is deterministic, unlike guessing a fixed delay — scanning too
  // early was the cause of this spec's historical flakiness.
  async function waitForWeekLoaded(page: Page): Promise<void> {
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 20_000 })
    await page.waitForTimeout(200) // one frame for the pills to paint
  }

  // The booked slot may fall in a later calendar week than the current one, so
  // scan forward a few weeks before giving up.
  async function openOnCalendar(page: Page, name: string): Promise<void> {
    for (let week = 0; week < 5; week++) {
      await waitForWeekLoaded(page)
      if (await tryOpenInView(page, name)) return
      await page.getByTestId('cal-next').click()
      await expect(page.getByTestId('cal-week-label')).toBeVisible()
    }
    throw new Error(`appointment "${name}" not found within 5 calendar weeks`)
  }

  test('a booking can be found on the week grid and opened', async ({ page }) => {
    const name = letterName()
    await seedUpcomingAppointment(name)
    await login(page)

    await page.goto('/dashboard/calendar')
    await expect(page.getByTestId('cal-week-label')).toBeVisible()

    await openOnCalendar(page, name)

    // The drawer shows the booking's details — and no approval actions, which
    // were removed with the pending workflow.
    const drawer = page.getByRole('dialog')
    await expect(drawer).toContainText(name)
    await expect(drawer.getByTestId('status-approved')).toBeVisible()
    await expect(page.getByTestId('cal-approve')).toHaveCount(0)
    await expect(page.getByTestId('cal-reject')).toHaveCount(0)

    // Self-clean: drive it to a terminal state so it drops out of the usage count.
    await cancelAppt(page, name)
  })
})
