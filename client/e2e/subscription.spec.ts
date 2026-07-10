import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Subscription page + dashboard billing surface for the seeded org, which is
 * pinned to an ACTIVE starter plan (migration 072 / e2e stability). The
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

  test('an active org sees its current plan, usage bar, both cards, and the Business contact line', async ({ page }) => {
    // Current plan block: starter label + price, no trial chip (it's active).
    await expect(page.getByRole('heading', { name: 'მიმდინარე გეგმა' })).toBeVisible()
    await expect(page.getByTestId('trial-chip')).toHaveCount(0)

    // Usage bar against the enforced monthly cap (150 for starter).
    await expect(page.getByText('ჯავშნები ამ თვეში')).toBeVisible()
    await expect(page.getByText(/\/\s*150/)).toBeVisible()

    // Both self-serve cards, Pro flagged recommended; Business is NOT a card
    // (superadmin-assigned) but appears as the quiet contact line.
    await expect(page.getByRole('heading', { name: 'სტარტერი' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'პრო' })).toBeVisible()
    await expect(page.getByText('რეკომენდებული')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ბიზნესი' })).toHaveCount(0)
    await expect(page.getByText('დიდი გუნდისთვის — მოგვწერეთ')).toBeVisible()
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
