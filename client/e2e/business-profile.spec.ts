import { test, expect } from '@playwright/test'
import { login, fillStable, signInSeed, SEED } from './helpers'

/**
 * Business-info settings — persisting cases. Validation-only partitions (save
 * gating, logo rejection) live in data-driven/profile.spec.ts; this spec covers
 * the address round-trip, restoring the seed's empty address afterwards so no
 * residue is left. The address feeds the booking-confirmation SMS (077), which
 * is server-side and asserted here only as far as the persisted column.
 *
 * The contact email is MANDATORY (merchant disclosure), so the seed org must
 * always carry one — a spec that changes it has to put a real address back, not
 * an empty string.
 */
const SEED_EMAIL = 'seed@example.ge'

test.describe('Settings — Business info', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
  })

  test('address saves, survives a reload, and can be cleared again', async ({ page }) => {
    const address = 'ე2ე ტესტის მისამართი 42'

    await fillStable(page.getByTestId('profile-address'), address)
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('profile-address')).toHaveValue(address)

    // The public booking page shows the saved address in the branded sidebar,
    // under the contact phone (get_public_org carries it since 078).
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-address')).toContainText(address)

    // Clear it back to the seed state (empty ⇒ stored as NULL).
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
    await fillStable(page.getByTestId('profile-address'), '')
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('profile-address')).toHaveValue('')
  })

  // Merchant legal disclosure (E-Commerce Law Art. 4 / Consumer Law Art. 5): the
  // business email persists and surfaces on the public booking page.
  test('email saves and shows on the booking page', async ({ page }) => {
    const email = 'e2e-legal@example.com'

    await fillStable(page.getByTestId('profile-email'), email)
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('profile-email')).toHaveValue(email)

    // Public booking page shows it in the branded sidebar (get_public_org).
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-email')).toContainText(email)

    // Restore the seed's resting address. It CANNOT be cleared (see below), so
    // the seed keeps a real email rather than going back to empty.
    await page.goto('/dashboard/settings/profile')
    await expect(page.getByTestId('profile-save')).toBeVisible()
    await fillStable(page.getByTestId('profile-email'), SEED_EMAIL)
    await page.getByTestId('profile-save').click()
    await expect(page.getByTestId('toast')).toBeVisible()
  })

  test('the email cannot be emptied once the business has one', async ({ page }) => {
    // It is a legal disclosure published on the booking page, and onboarding
    // already refuses to continue without one — so clearing it here would let a
    // business sign up compliant and then delete the disclosure.
    await fillStable(page.getByTestId('profile-email'), '')
    await page.getByTestId('profile-save').click()

    // Inline required error, no toast, nothing saved.
    await expect(page.getByTestId('profile-email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('toast')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('profile-email')).toHaveValue(SEED_EMAIL)
  })

  test('an invalid email is flagged inline and blocks save', async ({ page }) => {
    await fillStable(page.getByTestId('profile-email'), 'not-an-email')
    await page.getByTestId('profile-save').click()
    // Inline per-field error (no toast); nothing persisted.
    await expect(page.getByTestId('profile-email')).toHaveAttribute('aria-invalid', 'true')
    await fillStable(page.getByTestId('profile-email'), '')
  })

  test('the email rules are enforced by the DATABASE, not just the form', async () => {
    // Regression (20260821120000): contact_email had no CHECK, so the inline
    // validation above was the only thing enforcing it — a direct PATCH stored
    // anything, and get_public_org serves that value onto the public booking
    // page. The owner's own credentials are used deliberately: this is about
    // what an authorised caller can store, not about who may write.
    const ctx = await signInSeed()
    const patch = (contact_email: string | null) =>
      fetch(`${ctx.url}/rest/v1/organisations?slug=eq.${SEED.slug}`, {
        method: 'PATCH',
        headers: {
          apikey: ctx.anonKey,
          authorization: `Bearer ${ctx.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ contact_email }),
      })

    for (const bad of [
      'not-an-email',
      'a@b',                    // no dotted domain
      '@example.ge',            // empty local part
      ' padded@example.ge ',    // whitespace is not silently trimmed away
      `${'x'.repeat(250)}@b.ge`, // over the 254-char cap
    ]) {
      expect((await patch(bad)).status, `expected the DB to refuse ${JSON.stringify(bad)}`).toBe(400)
    }

    // A real address still saves. NULL stays legal at the DB level — the column
    // is nullable for the 15 legacy orgs created before the field was
    // mandatory; the "must not be empty" rule lives on the form.
    expect((await patch('owner@example.ge')).status).toBe(204)
    expect((await patch(SEED_EMAIL)).status).toBe(204)
  })
})
