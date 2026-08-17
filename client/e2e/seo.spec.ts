import { test, expect } from '@playwright/test'
import { SEED } from './helpers'

/**
 * Client-side SEO: per-route <title>/description/canonical, <html lang> sync,
 * noindex on the 404, and robots.txt. The Vercel edge functions (per-org OG +
 * LocalBusiness JSON-LD on /book/:slug, and /sitemap.xml) can't run under vite
 * dev — they're verified post-deploy by curl (see the plan / e2e README).
 */
test.describe('SEO — client head', () => {
  test('homepage sets ka title, description, canonical and html lang', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Vis/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ka')
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', /.+/)
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', /\/$/)
  })

  test('switching language updates html lang and the title', async ({ page }) => {
    await page.goto('/')
    const before = await page.title()

    await page.getByTestId('language-switcher-btn').click()
    await page.getByTestId('language-option-en').click()

    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    // The English homepage title differs from the Georgian one.
    await expect(async () => expect(await page.title()).not.toBe(before)).toPass()
    await expect(page).toHaveTitle(/Vis/)
  })

  test('booking page title carries the business name and a clean canonical', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}`)
    // Org loads → title includes its name (seed org name).
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveTitle(new RegExp(SEED.orgName))
    await expect(page.locator('head link[rel="canonical"]'))
      .toHaveAttribute('href', new RegExp(`/book/${SEED.slug}$`))
  })

  test('embed mode still renders the booking flow', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}?embed=1`)
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 30_000 })
    // Embeds carry the host site's branding — no sidebar, so no Vis wordmark.
    await expect(page.getByTestId('booking-vis-watermark')).toHaveCount(0)
  })

  test('unknown route gets the not-found title and a client noindex', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-xyz')
    await expect(page).toHaveTitle(/Vis/)
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    // Non-transactional pages must NOT leave a stale canonical behind.
    await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0)
  })

  test('robots.txt is served with the sitemap reference', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('Sitemap: https://vis.ge/sitemap.xml')
    expect(body).toContain('Disallow: /dashboard')
  })
})
