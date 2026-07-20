import { test, expect } from '@playwright/test'
import { login } from './helpers'

/**
 * Concierge onboarding — the "we set it up for you" request form
 * (/onboarding/help, backed by setup_requests + submit_setup_request).
 * Self-cleans: the pending state offers "cancel request", which deletes the
 * row (requester delete policy), so the seeded account ends with no residue.
 * The superadmin side (queue, create-org, complete + SMS) needs a superadmin
 * account, which isn't provisioned here — same limitation as the tier flows
 * in superadmin.spec.ts.
 */
test.describe('Onboarding — setup help request', () => {
  test('submit a request, see the pending state after reload, cancel it', async ({ page }) => {
    await login(page)
    await page.goto('/onboarding/help')

    // Form loads (no open request on the seed account). The contact phone
    // pre-fills from the logged-in account; email is required and starts empty.
    await expect(page.getByTestId('setup-help-submit')).toBeVisible()
    await expect(page.getByTestId('setup-help-phone')).not.toHaveValue('')

    // Submit is always enabled; clicking with empty required fields flags them.
    await page.getByTestId('setup-help-submit').click()
    await expect(page.getByTestId('setup-help-name')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('setup-help-email')).toHaveAttribute('aria-invalid', 'true')

    await page.getByTestId('setup-help-name').fill('E2E დახმარების ბიზნესი')
    await page.getByTestId('setup-help-email').fill('e2e-help@example.com')
    await page.getByTestId('setup-help-address').fill('თბილისი, ტესტის 1')
    await page.getByTestId('setup-help-details').fill('სერვისები: თმის შეჭრა 40₾ 45წთ. სპეციალისტი: ნინო. საათები: ორშ–შაბ 10–19.')
    await page.getByTestId('setup-help-submit').click()

    // Success state, and it persists across a reload (one open request per user).
    await expect(page.getByTestId('setup-help-pending')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('setup-help-pending')).toBeVisible()

    // Withdraw — back to a fresh form; the row is gone.
    await page.getByTestId('setup-help-cancel').click()
    await expect(page.getByTestId('setup-help-submit')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('setup-help-submit')).toBeVisible()
  })
})
