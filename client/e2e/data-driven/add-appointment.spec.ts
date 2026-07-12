import { test, expect } from '@playwright/test'
import { login, fillStable } from '../helpers'
import data from '../data/add-appointment.json' with { type: 'json' }

const FIELD_TESTIDS: Record<string, string> = {
  firstName: 'add-appt-first-name',
  phone: 'add-appt-phone',
}

/**
 * Data-driven field validation of the add-appointment dialog (cases in
 * e2e/data/add-appointment.json). AddAppointmentDialog derives per-field error
 * states (aria-invalid) from the shared validators; this spec asserts those
 * directly without driving a full create (the date picker has no testid, and
 * real appointment creation is covered by the public-booking flows). The save
 * button is no longer validation-disabled, so it isn't asserted here.
 */
test.describe('Data-driven — Add appointment dialog', () => {
  test('field-level validation across name/phone partitions', async ({ page }) => {
    await login(page)
    await page.getByTestId('appt-add-btn').click()
    await expect(page.getByTestId('add-appt-dialog')).toBeVisible()

    for (const c of data.fieldCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const input = page.getByTestId(FIELD_TESTIDS[c.field])
        await fillStable(input, c.value)
        if (c.errorShown) await expect(input).toHaveAttribute('aria-invalid', 'true')
        else await expect(input).not.toHaveAttribute('aria-invalid', 'true')
      })
    }

    await page.getByTestId('add-appt-cancel').click()
    // Dialog dismissed — nothing created.
  })
})
