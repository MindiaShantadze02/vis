import { test, expect } from '@playwright/test'
import { login, signInSeed } from './helpers'

/**
 * Superadmin area — role/permission (equivalence partition: superadmin vs a
 * normal owner). SuperAdminGuard redirects any non-superadmin to /dashboard,
 * so a regular owner can never reach the platform console or its sub-routes.
 *
 * NOTE: the privileged flows (changing an org's tier, add/remove superadmins)
 * require a superadmin test account, which isn't provisioned in this
 * environment. They're intentionally left as a follow-up — see e2e/README.md.
 */
test.describe('Superadmin — access control', () => {
  test.beforeEach(async ({ page }) => {
    await login(page) // seeded owner — not a superadmin
  })

  test('a normal owner is redirected away from the superadmin console', async ({ page }) => {
    await page.goto('/superadmin')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
  })

  test('a normal owner cannot reach superadmin sub-routes', async ({ page }) => {
    await page.goto('/superadmin/orgs')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto('/superadmin/requests')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto('/superadmin/admins')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto('/superadmin/billing')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
  })

  /**
   * The route guard is cosmetic — the RPCs behind the billing console are what
   * actually hold the line. They return every org's balance and the platform's
   * whole revenue history, and there is no RLS behind them: the is_superadmin()
   * check inside each function IS the access control. So assert it directly,
   * with a normal owner's token, rather than trusting the redirect.
   */
  test('platform financial RPCs refuse a normal owner', async () => {
    const ctx = await signInSeed()
    for (const [fn, body] of [
      ['platform_billing_health', { p_months: 6 }],
      ['platform_ops_health', {}],
      ['platform_retro_cancel_stats', { p_days: 90 }],
    ] as const) {
      const res = await fetch(`${ctx.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: ctx.anonKey,
          authorization: `Bearer ${ctx.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      expect(res.ok, `${fn} must refuse a non-superadmin`).toBeFalsy()
      expect(await res.text()).toContain('forbidden')
    }
  })
})
