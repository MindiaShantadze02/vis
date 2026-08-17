import { test, expect } from '@playwright/test'
import { login, tag, SEED } from './helpers'

// A tiny valid 1x1 PNG, used as the uploaded service image. Kept inline so the
// spec needs no fixture file on disk.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function pngFile(name: string) {
  return { name, mimeType: 'image/png', buffer: PNG_1x1 }
}

test.describe('Service thumbnail', () => {
  test('add a photo to a service, see it in settings and on the booking page', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/services')
    await expect(page.getByTestId('service-add')).toBeVisible()

    const rows = page.getByTestId('service-row')
    await expect(rows.first()).toBeVisible()

    // Create a service with a thumbnail picked while the create dialog is open
    // (the staged file is persisted after the service row is inserted).
    const name = tag('E2E Photo Service')
    await page.getByTestId('service-add').click()
    await page.getByTestId('service-name').fill(name)
    await page.getByTestId('service-duration').fill('30')
    await page.getByTestId('service-price').fill('25')
    await page.getByTestId('service-image-input').setInputFiles(pngFile('a.png'))
    // The staged thumbnail shows immediately (a local blob preview) and the
    // picker holds exactly one photo — there is no gallery to add a second to.
    await expect(page.getByTestId('service-image-picker').locator('img')).toHaveCount(1)
    await expect(page.getByTestId('service-image-add')).toHaveCount(0)
    await page.getByTestId('service-save').click()

    const row = rows.filter({ hasText: name })
    await expect(row).toBeVisible()
    // The list row shows the persisted thumbnail (proves upload + column write).
    await expect(row.getByTestId('service-row-thumb')).toBeVisible({ timeout: 20_000 })

    // On the customer booking page the service card shows that one photo as its
    // banner — no "+N photos" badge, no lightbox.
    await page.goto(`/book/${SEED.slug}`)
    const card = page.getByTestId('service-card').filter({ hasText: name })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.locator('img').first()).toBeVisible()
    await expect(card.getByTestId('view-photos')).toHaveCount(0)

    // The photo is on the card itself, so it shows on mobile too.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(card.locator('img').first()).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 })

    // Selecting the service advances to the date step; the sidebar carries the
    // booking summary only — the photo strip is gone.
    await card.getByTestId('book-service').click()
    await expect(page.getByTestId('book-week-strip')).toBeVisible()
    await expect(page.getByTestId('sidebar-gallery')).toHaveCount(0)

    // Removing the photo in settings clears the row thumbnail.
    await page.goto('/dashboard/settings/services')
    const editRow = page.getByTestId('service-row').filter({ hasText: name })
    await editRow.getByTestId('service-edit').click()
    await page.getByTestId('service-image-remove').click()
    await expect(page.getByTestId('service-image-add')).toBeVisible()
    await page.getByTestId('service-save').click()
    await expect(editRow.getByTestId('service-row-thumb')).toHaveCount(0, { timeout: 20_000 })

    // Clean up: delete the service so the seeded org isn't left with residue.
    const delRow = page.getByTestId('service-row').filter({ hasText: name })
    await expect(delRow).toBeVisible()
    await delRow.getByTestId('service-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('service-row').filter({ hasText: name })).toHaveCount(0, { timeout: 20_000 })
  })
})
