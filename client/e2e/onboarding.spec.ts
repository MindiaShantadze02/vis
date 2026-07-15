import { test, expect } from '@playwright/test'
import { register, uniquePhone, tag, fillStable } from './helpers'

// The word the delete-account dialog requires (Georgian is the default locale).
const DELETE_CONFIRM_WORD = 'წაშლა'

test.describe('Business onboarding', () => {
  test('a new owner completes all four steps and gets an org', async ({ page }) => {
    await register(page, uniquePhone())

    // The concierge escape hatch ("we'll set it up for you") is offered on the
    // wizard; the flow itself is covered in setup-help.spec.ts.
    await expect(page.getByTestId('onboarding-help-link')).toBeVisible()

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
    await expect(page).toHaveURL(/\/onboarding\/specialists/)

    // Step 3 — specialists (optional): add one bookable specialist, with the
    // same entrance-animation retry as the service form.
    await expect(async () => {
      await page.getByTestId('onb-specialist-name').fill('Etest Specialist')
      const save = page.getByTestId('onb-specialist-save')
      await expect(save).toBeEnabled({ timeout: 2_000 })
      await save.click()
      await expect(page.getByTestId('onb-specialist-row')).toHaveCount(1, { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })

    await page.getByTestId('onb-specialists-next').click()
    await expect(page).toHaveURL(/\/onboarding\/hours/)

    // Step 4 — accept the default Mon–Fri hours and finish
    await page.getByTestId('hours-finish').click()

    // Org created → dashboard, with the shareable booking link.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    await expect(page.getByText(bizName)).toBeVisible()
    await expect(page.getByText(/vis\.ge\/book\//)).toBeVisible()

    // The new-org onboarding checklist is up (nothing dismissed yet).
    await expect(page.getByTestId('onboarding-checklist')).toBeVisible()

    // A brand-new org starts on the 30-day Starter trial (no free tier): the
    // subscription page shows the trial chip and no trial-countdown banner yet
    // (that appears only in the last 7 days).
    await page.goto('/dashboard/settings/subscription')
    await expect(page.getByTestId('trial-chip')).toBeVisible()
    await expect(page.getByTestId('trial-countdown-banner')).toHaveCount(0)

    // --- self-clean: delete the throwaway account + org (Account settings) ---
    await page.goto('/dashboard/settings/account')
    await page.getByTestId('delete-account-btn').click()
    await page.getByTestId('delete-confirm-input').fill(DELETE_CONFIRM_WORD)
    await page.getByTestId('delete-account-confirm').click()
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
  })
})

test.describe('Business onboarding — edge cases', () => {
  // These leave a throwaway account with no org (like the auth signup test).

  test('the first step reports a missing name / invalid phone on Next', async ({ page }) => {
    const phone = uniquePhone()
    await register(page, phone)
    const next = page.getByTestId('biz-next')

    // The contact phone arrives pre-filled from the login phone the user just
    // registered with. Next is always enabled; clicking with no name flags the
    // field inline and stays on step 1.
    await expect(page.getByTestId('biz-phone')).toHaveValue(phone)
    await expect(next).toBeEnabled()
    await next.click()
    await expect(page.getByTestId('biz-name')).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/onboarding\/business/)

    // Name present but phone made invalid → flagged inline, still on step 1.
    await fillStable(page.getByTestId('biz-name'), 'AB')
    await fillStable(page.getByTestId('biz-phone'), '123')
    await next.click()
    await expect(page.getByTestId('biz-phone')).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/onboarding\/business/)

    // Valid name + phone advances to the services step.
    await fillStable(page.getByTestId('biz-phone'), '599123456')
    await next.click()
    await expect(page).toHaveURL(/\/onboarding\/services/)
    // Leaves a throwaway account with no org (never reached hours-finish).
  })

  test('a service typed but not "added" is kept when clicking Next', async ({ page }) => {
    await register(page, uniquePhone())
    await fillStable(page.getByTestId('biz-name'), tag('E2E Studio'))
    await fillStable(page.getByTestId('biz-phone'), '555123456')
    await page.getByTestId('biz-next').click()
    await expect(page).toHaveURL(/\/onboarding\/services/)

    // Fill a valid service but DON'T click "Add service", then hit Next. The step
    // animates in (framer-motion) and briefly detaches its buttons, so retry the
    // whole fill → enabled → click → navigate until it lands (mirrors the
    // happy-path's toPass). Next advancing proves the draft was auto-added rather
    // than silently dropped.
    const next = page.getByTestId('onb-services-next')
    await expect(async () => {
      await page.getByTestId('onb-service-name').fill('Massage')
      await page.getByTestId('onb-service-price').fill('40')
      await expect(next).toBeEnabled({ timeout: 1_500 })
      await next.click({ timeout: 2_500 })
      await expect(page).toHaveURL(/\/onboarding\/specialists/, { timeout: 2_500 })
    }).toPass({ timeout: 25_000 })

    // Going back shows the service was saved (one row present).
    await page.getByTestId('onb-specialists-back').click()
    await expect(page).toHaveURL(/\/onboarding\/services/)
    await expect(page.getByTestId('onb-service-row')).toHaveCount(1)

    // Same guarantee on the specialists step: a name typed but not "added" is
    // auto-added by Next instead of silently dropped. specialists-next is
    // ALWAYS enabled (the step is skippable), which defeats the suite's usual
    // enabled-gating workaround for the dev-only StrictMode+AnimatePresence
    // remount ~220ms after step arrival: anything typed before it is wiped and
    // Next then legitimately skips the step. Let the step settle past that
    // remount before typing, then verify the add through the sidebar preview
    // (it reads the shared onboarding state).
    await page.getByTestId('onb-services-next').click()
    await expect(page).toHaveURL(/\/onboarding\/specialists/)
    await page.waitForTimeout(800)
    await expect(async () => {
      await page.getByTestId('onb-specialist-name').fill('Etest Draftkeeper')
      await expect(page.getByTestId('onb-specialist-save')).toBeEnabled({ timeout: 1_500 })
    }).toPass({ timeout: 20_000 })
    await page.getByTestId('onb-specialists-next').click()
    await expect(page).toHaveURL(/\/onboarding\/hours/)
    // .first(): during the step transition the name shows both in the sidebar
    // preview and in the exiting step's list row.
    await expect(page.getByText('Etest Draftkeeper').first()).toBeVisible()
    // Leaves a throwaway account with no org (never reached hours-finish).
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
