import { test, expect } from '@playwright/test'
import { bookToDetails, fillStable } from '../helpers'
import data from '../data/booking-customer.json' with { type: 'json' }

/**
 * Data-driven gating of the public booking Step-3 form (cases in
 * e2e/data/booking-customer.json — pairwise field combinations, BVA on the
 * name minimum, error-guessing). The wizard is driven to Step 3 once; each
 * case applies base + deltas and asserts book-submit. Never submitted — the
 * end-to-end booking (with OTP) lives in booking.spec.ts.
 */
test.describe('Data-driven — Public booking details', () => {
  test('book-submit gating across field partitions', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()

    const firstName = page.getByTestId('book-first-name')
    const lastName = page.getByTestId('book-last-name')
    const phone = page.getByTestId('book-phone')
    const consent = page.getByTestId('book-consent').locator('input')
    const submit = page.getByTestId('book-submit')

    for (const c of data.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const f = { ...data.base, ...c.fields }
        await fillStable(firstName, f.firstName)
        await fillStable(lastName, f.lastName)
        await fillStable(phone, f.phone)
        await (f.consent ? consent.check() : consent.uncheck())

        if (c.valid) await expect(submit).toBeEnabled()
        else await expect(submit).toBeDisabled()
      })
    }

    const clamp = data.notesClampCase
    await test.step(`[${clamp.technique}] ${clamp.id} — ${clamp.note}`, async () => {
      const notes = page.getByTestId('book-notes')
      // fill() bypasses the maxLength attribute (it's only enforced for real
      // typing), so fill just under the cap and type the rest.
      await notes.fill('x'.repeat(clamp.typeLength - 2))
      await notes.pressSequentially('xx')
      const value = await notes.inputValue()
      expect(value.length).toBe(clamp.expectLength)
    })
    // Never submitted — no OTP requested, no appointment created.
  })
})
