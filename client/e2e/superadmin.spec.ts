import { test, expect } from '@playwright/test'
import { login } from './helpers'

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

    await page.goto('/superadmin/admins')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
  })
})
