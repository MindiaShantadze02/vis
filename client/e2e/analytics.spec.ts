import { test, expect } from '@playwright/test'
import { login, signInSeed, restApi } from './helpers'

/**
 * Owner analytics (Phase 6, migration 096). The get_org_analytics RPC returns a
 * pre-aggregated payload; the dashboard renders money cards + CSS-bar charts.
 */
test.describe('Analytics', () => {
  test('the RPC returns a well-formed aggregate for the seed org', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.test-appointments-studio&select=id`)) as { id: string }[]
    const res = (await restApi(ctx, 'rpc/get_org_analytics', {
      method: 'POST',
      body: JSON.stringify({ p_org_id: org[0].id, p_from: '2026-01-01', p_to: '2027-12-31' }),
    })) as Record<string, unknown>
    // Shape: money + histograms present and correctly sized.
    expect(res).toHaveProperty('revenue')
    expect(Array.isArray(res.by_weekday) && (res.by_weekday as unknown[]).length).toBe(7)
    expect(Array.isArray(res.by_hour) && (res.by_hour as unknown[]).length).toBe(24)
    expect(Number(res.bookings)).toBeGreaterThanOrEqual(Number(res.completed))
  })

  test('the analytics dashboard renders with a period selector', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/analytics')
    await expect(page.getByTestId('analytics-content')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('analytics-30')).toBeVisible()
    // Money cards render (Revenue label present).
    await expect(page.getByText('შემოსავალი').first()).toBeVisible()
  })
})
