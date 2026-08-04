import { test, expect } from '@playwright/test'
import { login, SEED } from './helpers'

// A tiny valid 1x1 PNG used as the uploaded cover, kept inline (no fixture file).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Booking-page settings — the customer-facing page controls (colour theme,
 * reviews toggle, shareable link/embed). Non-persisting: Save is never clicked,
 * so the seeded org's theme/reviews flag are left unchanged.
 */
test.describe('Settings — Booking page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/booking')
    await expect(page.getByTestId('booking-save')).toBeVisible()
  })

  test('shows the shareable link, embed code, and a preview link', async ({ page }) => {
    await expect(page.getByText(/vis\.ge\/book\//).first()).toBeVisible()
    await expect(page.getByText('embed.js')).toBeVisible()
    // "View page" opens the public booking page in a new tab.
    await expect(page.getByRole('link', { name: /გვერდის ნახვა/ })).toBeVisible()
  })

  test('a custom booking colour is accepted and reflected in the swatch', async ({ page }) => {
    await page.getByTestId('booking-custom-color').fill('#123456')
    // The custom tile shows the chosen hex (uppercased) once selected.
    await expect(page.getByText('#123456', { exact: false })).toBeVisible()
    // Not saved — booking theme is left unchanged on the seed.
  })

  test('the reviews toggle is present and switchable', async ({ page }) => {
    const toggle = page.getByTestId('reviews-enabled-toggle').locator('input')
    await expect(toggle).toBeChecked() // seed default is on
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    // Not saved — the org's reviews flag is left unchanged.
  })

  test('the automatic-approval toggle is present, on for the seed org, and switchable', async ({ page }) => {
    const toggle = page.getByTestId('auto-approve-toggle').locator('input')
    // The control is framed as "Automatic approval" (opt-in): OFF means the
    // approval-required default (the column default for new orgs since 080),
    // ON means auto-confirm. The seed org rests with auto-approve on
    // (require_approval = false), so the toggle reads checked.
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect(toggle).not.toBeChecked()
    // Not saved — the org keeps auto-approving; the pending workflow itself is
    // exercised (via setRequireApproval) in appointment-status/calendar specs.
  })

  test('upload a cover image, see it on the booking page, then remove it', async ({ page }) => {
    // Empty state before any cover is set.
    await expect(page.getByTestId('cover-upload')).toBeVisible()

    // Uploading persists immediately (like the logo) — a preview + remove appear.
    await page.getByTestId('cover-input').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG_1x1 })
    await expect(page.getByTestId('cover-preview')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('cover-remove')).toBeVisible()

    // The public booking page shows the cover as a hero band across the top.
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-cover')).toBeVisible({ timeout: 30_000 })

    // Remove it so the seeded org is left clean; the hero is gone afterwards.
    await page.goto('/dashboard/settings/booking')
    await page.getByTestId('cover-remove').click()
    await expect(page.getByTestId('cover-remove')).toHaveCount(0, { timeout: 20_000 })
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('booking-cover')).toHaveCount(0)
  })
})
