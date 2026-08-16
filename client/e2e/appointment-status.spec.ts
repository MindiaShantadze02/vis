import { test, expect, type Page } from '@playwright/test'
import { login, seedUpcomingAppointment, openApptByName, letterName, eraseClientByName } from './helpers'

/**
 * State-Transition testing for the appointment status machine, exercised through
 * the dashboard overview drawer:
 *
 *   approved ──cancel───▶ cancelled   (terminal)
 *      └──────no-show───▶ no_show     (terminal)
 *
 * The pending-approval workflow was removed (2026-08-14): every booking is
 * created 'approved', so 'approved' is now the only non-terminal state and the
 * approve/reject transitions no longer exist.
 *
 * Also covers guardrails (no actions on terminal states) and equivalence-
 * partitioning of the status filter (an item shows only in the partition
 * matching its current status).
 *
 * StatusChips render in every list row too, so status/action assertions are
 * scoped to the open detail drawer to avoid matching the list.
 */
test.describe('Appointment status transitions', () => {
  // Status filter labels (ka) — the MUI Select renders these as options.
  const LABEL = { approved: 'დამტკიცებული', cancelled: 'გაუქმებული' } as const

  const dialog = (page: Page) => page.getByRole('dialog')

  // The drawer renders as a modal with a backdrop that swallows clicks on the
  // page behind it, so it must be dismissed before touching the filter bar.
  async function closeDrawer(page: Page) {
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  }

  async function filterBy(page: Page, label: string) {
    await page.getByTestId('appt-status-filter').click()
    await page.getByRole('option', { name: label, exact: true }).click()
  }

  test('approved → cancelled, with filter partitioning and guardrails', async ({ page }) => {
    const name = letterName()
    await seedUpcomingAppointment(name)
    await login(page)

    // The freshly-created appointment starts approved.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()
    await closeDrawer(page)

    // ECP of the status filter: the item is in the "approved" partition.
    await filterBy(page, LABEL.approved)
    await expect(page.getByTestId('appt-row').filter({ hasText: name })).toBeVisible()
    await filterBy(page, LABEL.cancelled)
    await expect(page.getByTestId('appt-row').filter({ hasText: name })).toHaveCount(0)

    // approved → cancelled, exercising the two-step confirm (and its abort sub-state).
    await openApptByName(page, name)
    await dialog(page).getByTestId('appt-cancel').click()
    // Abort sub-state: "keep" returns to the pre-confirm state, still approved.
    await dialog(page).getByTestId('appt-keep').click()
    await expect(dialog(page).getByTestId('appt-cancel')).toBeVisible()
    // Now actually cancel.
    await dialog(page).getByTestId('appt-cancel').click()
    await dialog(page).getByTestId('appt-confirm-cancel').click()
    await expect(dialog(page)).toBeHidden() // drawer closed on status change

    // Terminal guardrail: a cancelled appointment exposes no further transitions.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-cancelled')).toBeVisible()
    await expect(dialog(page).getByTestId('appt-cancel')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-no-show')).toHaveCount(0)

    // Erase the client's data (Art. 16, erase_customer_data RPC) from the
    // dedicated Clients screen — anonymization blanks the customer's name/phone,
    // which doubles as cleanup of this run's PII.
    await eraseClientByName(page, name)

    // Left cancelled (terminal, PII erased) — excluded from the billable count.
  })

  test('approved → no_show is terminal', async ({ page }) => {
    const name = letterName()
    await seedUpcomingAppointment(name)
    await login(page)

    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()

    // approved → no_show (the slot was consumed, so it still counts toward usage)
    await dialog(page).getByTestId('appt-no-show').click()
    await expect(dialog(page)).toBeHidden()

    // Terminal: no further transitions offered.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-no_show')).toBeVisible()
    await expect(dialog(page).getByTestId('appt-cancel')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-no-show')).toHaveCount(0)

    await eraseClientByName(page, name)
  })
})
