import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Subscription page + dashboard billing surface for the seeded org, which is
 * pinned to an ACTIVE solo plan (migration 072/083 / e2e stability). The
 * trial-countdown, expired-notice and expired-strip states can't be produced
 * from the UI — the billing-column guard blocks it by design — so their state
 * derivation is covered by src/lib/tiers.test.ts and the onboarding spec
 * exercises the fresh-org trial. Here we cover everything reachable on an
 * active org.
 */
test.describe('Subscription', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/settings/subscription')
  })

  test('an active org sees its current plan, usage bar, and both tier cards', async ({ page }) => {
    // Current plan block: solo label + price, no trial chip (it's active).
    await expect(page.getByRole('heading', { name: 'მიმდინარე გეგმა' })).toBeVisible()
    await expect(page.getByTestId('trial-chip')).toHaveCount(0)

    // Usage bar against the enforced monthly cap (100 for solo).
    await expect(page.getByText('ჯავშნები ამ თვეში')).toBeVisible()
    await expect(page.getByText(/\/\s*100/)).toBeVisible()

    // Both self-serve cards, Team flagged recommended; the removed Business
    // tier must not resurface anywhere.
    await expect(page.getByRole('heading', { name: 'სოლო' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'გუნდი' })).toBeVisible()
    await expect(page.getByText('რეკომენდებული')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ბიზნესი' })).toHaveCount(0)
  })

  test('the dashboard usage meter is driven by entitlements (allowance, not blocked)', async ({ page }) => {
    // Exercises get_org_entitlements (migration 088) end-to-end: OrgContext
    // fetches it, useEntitlements feeds the meter. The seed org is active/solo
    // and under its allowance, so it shows "used / 100" with no overage line
    // and — critically — no "bookings blocked" copy (over-allowance is metered
    // now, never blocked).
    await page.goto('/dashboard')
    const meter = page.getByTestId('usage-meter')
    await expect(meter).toBeVisible()
    await expect(meter.getByText(/\/\s*100/)).toBeVisible()
    await expect(page.getByTestId('usage-overage')).toHaveCount(0)
  })

  test('an active org shows no trial/expired banner on the dashboard', async ({ page }) => {
    // Regression guard: SubscriptionBanner must render nothing for active orgs
    // (and its expired notice, when shown, must carry a dismiss control — see
    // the component; broken previously because MUI Alert drops onClose when an
    // action is set).
    await page.goto('/dashboard')
    await expect(page.getByTestId('trial-countdown-banner')).toHaveCount(0)
    await expect(page.getByTestId('expired-notice')).toHaveCount(0)
    await expect(page.getByTestId('expired-strip')).toHaveCount(0)
  })
})
