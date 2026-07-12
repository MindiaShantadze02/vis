import { test, expect } from '@playwright/test'
import { fillStable, SEED } from '../helpers'
import loginData from '../data/auth-login.json' with { type: 'json' }
import registerData from '../data/auth-register.json' with { type: 'json' }

/**
 * Data-driven validation of the login/register forms (cases in
 * e2e/data/auth-login.json / auth-register.json — BVA + ECP + error-guessing).
 * Buttons are never disabled for validation, so invalid rows are submitted and
 * must surface the login-error Alert while staying on the same page; valid rows
 * are only asserted enabled (never clicked, so no real sign-in / account
 * creation). Invalid submits all early-return synchronously before any network
 * call, so nothing leaves the browser.
 */
test.describe('Data-driven — Auth', () => {
  test('login validation across phone/password partitions', async ({ page }) => {
    await page.goto('/login')
    const phone = page.getByTestId('login-phone')
    const password = page.getByTestId('login-password')
    const submit = page.getByTestId('login-submit')
    const error = page.getByTestId('login-error')
    await expect(submit).toBeVisible()

    for (const c of loginData.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, c.fields.phone)
        await fillStable(password, c.fields.password)
        // The button is always enabled now.
        await expect(submit).toBeEnabled()
        if (!c.valid) {
          // Invalid input is reported on submit and never leaves /login.
          await submit.click()
          await expect(error).toBeVisible()
          await expect(page).toHaveURL(/\/login/)
        }
      })
    }
  })

  test('auth OTP code input partitions (transform + verify gating)', async ({ page }) => {
    // Reach the OTP step with the seeded account. A recent code for this phone
    // returns 'too_soon', which the page treats as "proceed to entry" — so this
    // works no matter how recently another spec logged in.
    await page.goto('/login')
    await page.getByTestId('login-phone').fill(SEED.phone)
    await page.getByTestId('login-password').fill(SEED.password)
    await page.getByTestId('login-submit').click()

    const code = page.getByTestId('auth-otp-code')
    await expect(code).toBeVisible({ timeout: 20_000 })
    const verify = page.getByTestId('auth-otp-verify')

    for (const c of loginData.otpInputCases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        // Plain fill, not fillStable — the input transforms what we type
        // (strips non-digits, clamps to 6), so what we set isn't what sticks.
        await code.fill('')
        await code.fill(c.type)
        await expect(code).toHaveValue(c.expectValue)
        // Verify is always enabled; a short code is rejected on click with a
        // field error rather than a disabled button. Only exercise the reject
        // path — clicking a full (verifyEnabled) code would submit for real.
        await expect(verify).toBeEnabled()
        if (!c.verifyEnabled) {
          await verify.click()
          await expect(code).toHaveAttribute('aria-invalid', 'true')
          await expect(code).toBeVisible() // still on the OTP step
        }
      })
    }
    // Never verified with a full code — no sign-in happens.
  })

  test('register validation across phone/password partitions', async ({ page }) => {
    await page.goto('/register')
    const phone = page.getByTestId('login-phone')
    const password = page.getByTestId('login-password')
    const confirm = page.getByTestId('login-confirm-password')
    const submit = page.getByTestId('login-submit')
    const error = page.getByTestId('login-error')
    await expect(submit).toBeVisible()

    for (const c of registerData.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, c.fields.phone)
        await fillStable(password, c.fields.password)
        await fillStable(confirm, c.fields.confirm)
        await expect(submit).toBeEnabled()
        if (!c.valid) {
          // Consent is left unchecked, but the phone/password error is reported
          // first and blocks the submit before the consent check.
          await submit.click()
          await expect(error).toBeVisible()
          await expect(page).toHaveURL(/\/register/)
        }
      })
    }
  })

  test('register consent is enforced on submit, not via the disabled state', async ({ page }) => {
    const c = registerData.consentCase
    await page.goto('/register')
    await fillStable(page.getByTestId('login-phone'), c.fields.phone)
    await fillStable(page.getByTestId('login-password'), c.fields.password)
    await fillStable(page.getByTestId('login-confirm-password'), c.fields.confirm)

    // Consent unchecked: the button is enabled by design…
    const submit = page.getByTestId('login-submit')
    await expect(submit).toBeEnabled()

    // …but submitting flags the consent box and never leaves the page
    // (startSignUp returns before any OTP request).
    await submit.click()
    await expect(page.getByTestId('consent-error')).toBeVisible()
    await expect(page).toHaveURL(/\/register/)
  })
})
