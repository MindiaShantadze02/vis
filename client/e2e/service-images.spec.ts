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

test.describe('Service images', () => {
  test('add a photo to a service, see it in settings and on the booking page', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/services')
    await expect(page.getByTestId('service-add')).toBeVisible()

    const rows = page.getByTestId('service-row')
    await expect(rows.first()).toBeVisible()

    // Create a service with one image, uploaded while the create dialog is open
    // (the staged file is persisted after the service row is inserted).
    const name = tag('E2E Photo Service')
    await page.getByTestId('service-add').click()
    await page.getByTestId('service-name').fill(name)
    await page.getByTestId('service-duration').fill('30')
    await page.getByTestId('service-price').fill('25')
    await page.getByTestId('service-image-input').setInputFiles(pngFile('a.png'))
    // The staged thumbnail shows immediately (a local blob preview).
    await expect(page.getByTestId('service-images-editor').locator('img')).toHaveCount(1)
    await page.getByTestId('service-save').click()

    const row = rows.filter({ hasText: name })
    await expect(row).toBeVisible()
    // The list row shows the persisted image thumbnail (proves upload + row insert).
    await expect(row.getByTestId('service-row-thumb')).toBeVisible({ timeout: 20_000 })

    // On the customer booking page the cards stay compact; selecting the
    // service shows its photos in the branded sidebar, which open a lightbox.
    await page.goto(`/book/${SEED.slug}`)
    const card = page.getByTestId('book-service').filter({ hasText: name })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.click()
    const gallery = page.getByTestId('sidebar-gallery')
    await expect(gallery).toBeVisible()
    await gallery.getByTestId('gallery-thumb').first().click()
    await expect(page.getByTestId('gallery-close')).toBeVisible()
    await page.getByTestId('gallery-close').click()

    // Clean up: delete the service (cascades the image row; the component also
    // removes the storage object) so the seeded org isn't left with residue.
    await page.goto('/dashboard/settings/services')
    const delRow = page.getByTestId('service-row').filter({ hasText: name })
    await expect(delRow).toBeVisible()
    await delRow.getByTestId('service-delete').click()
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('service-row').filter({ hasText: name })).toHaveCount(0, { timeout: 20_000 })
  })
})
