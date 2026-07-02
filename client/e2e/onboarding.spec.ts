import { test, expect } from '@playwright/test'
import { register, uniquePhone, tag, fillStable } from './helpers'

// The word the delete-account dialog requires (Georgian is the default locale).
const DELETE_CONFIRM_WORD = 'წაშლა'

test.describe('Business onboarding', () => {
  test('a new owner completes all three steps and gets an org', async ({ page }) => {
    await register(page, uniquePhone())

    // Step 1 — business profile
    const bizName = tag('E2E Studio')
    await fillStable(page.getByTestId('biz-name'), bizName)
    await fillStable(page.getByTestId('biz-phone'), '555123456')
    await page.getByTestId('biz-next').click()
    await expect(page).toHaveURL(/\/onboarding\/services/)

    // The live sidebar preview reflects what was typed.
    await expect(page.getByText(bizName)).toBeVisible()

    // Step 2 — add a service. The step animates in (framer-motion) and the save
    // button briefly toggles disabled/detaches mid-entrance, so retry the whole
    // fill → save → row-appears operation until it lands. Name is letters-only
    // (isValidPersonName rejects digits).
    await expect(async () => {
      await page.getByTestId('onb-service-name').fill('Haircut')
      await page.getByTestId('onb-service-price').fill('25')
      const save = page.getByTestId('onb-service-save')
      await expect(save).toBeEnabled({ timeout: 2_000 })
      await save.click()
      await expect(page.getByTestId('onb-service-row')).toHaveCount(1, { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })

    await page.getByTestId('onb-services-next').click()
    await expect(page).toHaveURL(/\/onboarding\/hours/)

    // Step 3 — accept the default Mon–Fri hours and finish
    await page.getByTestId('hours-finish').click()

    // Org created → dashboard, with the shareable booking link.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    await expect(page.getByText(bizName)).toBeVisible()
    await expect(page.getByText(/vis\.ge\/book\//)).toBeVisible()

    // --- self-clean: delete the throwaway account + org ---
    await page.goto('/dashboard/settings/profile')
    await page.getByTestId('delete-account-btn').click()
    await page.getByTestId('delete-confirm-input').fill(DELETE_CONFIRM_WORD)
    await page.getByTestId('delete-account-confirm').click()
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
  })
})

test.describe('Business onboarding — edge cases', () => {
  // These leave a throwaway account with no org (like the auth signup test).

  test('the first step gates "next" until name + valid phone are present', async ({ page }) => {
    await register(page, uniquePhone())
    const next = page.getByTestId('biz-next')
    await expect(next).toBeDisabled()                       // empty

    await fillStable(page.getByTestId('biz-name'), 'AB')
    await expect(next).toBeDisabled()                       // no phone yet

    await fillStable(page.getByTestId('biz-phone'), '123')  // invalid phone
    await expect(next).toBeDisabled()

    await fillStable(page.getByTestId('biz-phone'), '599123456')
    await expect(next).toBeEnabled()
  })

  test('skip sends the user to the dashboard, and org-only routes bounce back', async ({ page }) => {
    await register(page, uniquePhone())
    // Skip control lives in the shell header (no testid) — target by label.
    await page.getByRole('button', { name: /გამოტოვება/ }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    // With no org yet, an org-guarded route redirects back to the dashboard.
    await page.goto('/dashboard/calendar')
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
