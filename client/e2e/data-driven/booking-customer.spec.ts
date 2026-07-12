import { test, expect } from '@playwright/test'
import { bookToDetails, fillStable } from '../helpers'
import data from '../data/booking-customer.json' with { type: 'json' }

/**
 * Data-driven validation of the public booking Step-3 form (cases in
 * e2e/data/booking-customer.json — pairwise field combos, BVA on the name
 * minimum, error-guessing, consent). book-submit is never disabled for
 * validation: invalid rows are submitted and must surface the book-error Alert
 * while staying on Step 3 (sendCode validates before requesting an OTP). Valid
 * rows are only asserted enabled — clicking one would request a real OTP — so
 * nothing is submitted.
 */
test.describe('Data-driven — Public booking details', () => {
  test('book-submit validation across field partitions', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()

    const firstName = page.getByTestId('book-first-name')
    const lastName = page.getByTestId('book-last-name')
    const phone = page.getByTestId('book-phone')
    const consent = page.getByTestId('book-consent').locator('input')
    const submit = page.getByTestId('book-submit')
    const error = page.getByTestId('book-error')

    for (const c of data.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        const f = { ...data.base, ...c.fields }
        await fillStable(firstName, f.firstName)
        await fillStable(lastName, f.lastName)
        await fillStable(phone, f.phone)
        await (f.consent ? consent.check() : consent.uncheck())

        await expect(submit).toBeEnabled()
        if (!c.valid) {
          await submit.click()
          await expect(error).toBeVisible()
          await expect(submit).toBeVisible() // still on Step 3 — no OTP requested
        }
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
    // Valid rows never clicked — no OTP requested, no appointment created.
  })
})
