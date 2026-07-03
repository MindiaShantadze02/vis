import { test, expect, type Page } from '@playwright/test'
import { login, bookPending, openApptByName, letterName } from './helpers'

/**
 * State-Transition testing for the appointment status machine, exercised through
 * the dashboard overview dialog:
 *
 *   pending ──approve──▶ approved ──cancel──▶ cancelled   (terminal)
 *      └─────reject─────▶ rejected                        (terminal)
 *
 * Also covers guardrails (no illegal transitions / no actions on terminal
 * states) and equivalence-partitioning of the status filter (an item shows only
 * in the partition matching its current status). Each test books a real pending
 * appointment on the seeded org; it ends in a terminal state (cancelled /
 * rejected) that's excluded from the monthly tier count, matching booking.spec's
 * documented persistence.
 *
 * StatusChips render in every list row too, so status/action assertions are
 * scoped to the open detail dialog to avoid matching the list.
 */
test.describe('Appointment status transitions', () => {
  // Status filter labels (ka) — the MUI Select renders these as options.
  const LABEL = { pending: 'მოლოდინში', approved: 'დამტკიცებული' } as const

  const dialog = (page: Page) => page.getByRole('dialog')

  async function filterBy(page: Page, label: string) {
    await page.getByTestId('appt-status-filter').click()
    await page.getByRole('option', { name: label, exact: true }).click()
  }

  test('pending → approved → cancelled, with filter partitioning and guardrails', async ({ page }) => {
    const name = letterName()
    await bookPending(page, name)
    await login(page)

    // Open the freshly-created appointment — it starts pending.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-pending')).toBeVisible()
    // Guardrail: a pending appointment cannot be cancelled directly (approve/reject only).
    await expect(dialog(page).getByTestId('appt-cancel')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-confirm-cancel')).toHaveCount(0)

    // pending → approved
    await dialog(page).getByTestId('appt-approve').click()
    await expect(dialog(page)).toBeHidden() // dialog closed on status change

    // ECP of the status filter: the item is in the "approved" partition, not "pending".
    await filterBy(page, LABEL.approved)
    await expect(page.getByTestId('appt-row').filter({ hasText: name })).toBeVisible()
    await filterBy(page, LABEL.pending)
    await expect(page.getByTestId('appt-row').filter({ hasText: name })).toHaveCount(0)

    // approved → cancelled, exercising the two-step confirm (and its abort sub-state).
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()
    await dialog(page).getByTestId('appt-cancel').click()
    // Abort sub-state: "keep" returns to the pre-confirm state, still approved.
    await dialog(page).getByTestId('appt-keep').click()
    await expect(dialog(page).getByTestId('appt-cancel')).toBeVisible()
    // Now actually cancel.
    await dialog(page).getByTestId('appt-cancel').click()
    await dialog(page).getByTestId('appt-confirm-cancel').click()
    await expect(dialog(page)).toBeHidden() // dialog closed

    // Terminal guardrail: a cancelled appointment exposes no further transitions.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-cancelled')).toBeVisible()
    await expect(dialog(page).getByTestId('appt-approve')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-reject')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-cancel')).toHaveCount(0)

    // Left cancelled (terminal) — excluded from the monthly usage count.
  })

  test('pending → rejected is terminal', async ({ page }) => {
    const name = letterName()
    await bookPending(page, name)
    await login(page)

    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-pending')).toBeVisible()

    // pending → rejected
    await dialog(page).getByTestId('appt-reject').click()
    await expect(dialog(page)).toBeHidden() // dialog closed

    // Terminal: no further transitions offered.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-rejected')).toBeVisible()
    await expect(dialog(page).getByTestId('appt-approve')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-reject')).toHaveCount(0)
    await expect(dialog(page).getByTestId('appt-cancel')).toHaveCount(0)

    // Left rejected (terminal) — excluded from the monthly usage count.
  })
})
