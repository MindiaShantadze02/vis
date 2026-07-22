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

    // Usage bar shows "used / total", where total folds any purchased extra
    // appointments into the monthly allowance (so the denominator is dynamic).
    await expect(page.getByText('ჯავშნები ამ თვეში')).toBeVisible()
    await expect(page.getByText(/\d+\s*\/\s*\d+/).first()).toBeVisible()

    // Both self-serve cards, Team flagged recommended; the removed Business
    // tier must not resurface anywhere.
    await expect(page.getByRole('heading', { name: 'სოლო' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'გუნდი' })).toBeVisible()
    await expect(page.getByText('რეკომენდებული')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ბიზნესი' })).toHaveCount(0)
  })

  test('the dashboard usage meter is driven by entitlements (total folds in extras)', async ({ page }) => {
    // Exercises get_org_entitlements end-to-end: OrgContext fetches it,
    // useEntitlements feeds the meter. The seed org is active/solo and under its
    // allowance, so it shows "used / total" (total = 80 + purchased extras) and,
    // critically, no "out of appointments" blocked copy.
    await page.goto('/dashboard')
    const meter = page.getByTestId('usage-meter')
    await expect(meter).toBeVisible()
    await expect(meter.getByText(/\d+\s*\/\s*\d+/)).toBeVisible()
    await expect(page.getByTestId('usage-blocked')).toHaveCount(0)
  })

  test('an active org can buy booking credits through the mock gateway and the balance grows', async ({ page }) => {
    // Hard-cap top-up flow (2026-07-22): pick a server-defined pack → create-payment
    // (purpose credit, price resolved server-side) → mock gateway → payment-webhook
    // grants the credits → the balance on this page reflects the increase.
    const readBalance = async () =>
      Number(((await page.getByTestId('credit-balance').textContent()) ?? '').match(/\d+/)?.[0] ?? '0')
    await expect(page.getByTestId('credit-balance')).toBeVisible()
    const before = await readBalance()

    await page.getByTestId('buy-credit-pack_20').click()
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })
    await page.getByTestId('payment-return-primary').click()
    await expect(page).toHaveURL(/\/settings\/subscription/, { timeout: 20_000 })

    // The pack_20 pack grants 20 credits; the balance line refreshes on return.
    await expect.poll(readBalance, { timeout: 15_000 }).toBe(before + 20)
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
