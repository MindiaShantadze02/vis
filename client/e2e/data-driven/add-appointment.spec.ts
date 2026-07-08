import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/add-appointment.json' with { type: 'json' }

const FIELD_TESTIDS: Record<string, string> = {
  firstName: 'add-appt-first-name',
  phone: 'add-appt-phone',
}

/**
 * Data-driven field validation of the add-appointment dialog (cases in
 * e2e/data/add-appointment.json). The dialog's date picker has no testid, so
 * instead of driving a full create this asserts the per-field error state
 * (aria-invalid) that AddAppointmentDialog derives from the shared validators;
 * save stays disabled throughout because no service/slot is picked. Real
 * appointment creation is covered by the public-booking flows.
 */
test.describe('Data-driven — Add appointment dialog', () => {
  test('field-level validation across name/phone partitions', async ({ page }) => {
    await login(page)
    await page.getByTestId('appt-add-btn').click()
    await expect(page.getByTestId('add-appt-dialog')).toBeVisible()
    const save = page.getByTestId('add-appt-save')

    for (const c of data.fieldCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const input = page.getByTestId(FIELD_TESTIDS[c.field])
        await fillStable(input, c.value)
        if (c.errorShown) await expect(input).toHaveAttribute('aria-invalid', 'true')
        else await expect(input).not.toHaveAttribute('aria-invalid', 'true')
        // Guard: without a service/date/slot the save can never enable.
        await expect(save).toBeDisabled()
      })
    }

    await page.getByTestId('add-appt-cancel').click()
    // Dialog dismissed — nothing created.
  })
})
