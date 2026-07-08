import { test, expect } from '@playwright/test'
import { fillStable, SEED } from '../helpers'
import loginData from '../data/auth-login.json' with { type: 'json' }
import registerData from '../data/auth-register.json' with { type: 'json' }

/**
 * Data-driven gating of the login/register forms. Every case lives in
 * e2e/data/auth-login.json / auth-register.json (BVA + ECP + error-guessing);
 * this spec only iterates them. Nothing here submits credentials or creates an
 * account — flows are covered by auth.spec.ts.
 */
test.describe('Data-driven — Auth', () => {
  test('login submit gating across phone/password partitions', async ({ page }) => {
    await page.goto('/login')
    const phone = page.getByTestId('login-phone')
    const password = page.getByTestId('login-password')
    const submit = page.getByTestId('login-submit')
    await expect(submit).toBeVisible()

    for (const c of loginData.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, c.fields.phone)
        await fillStable(password, c.fields.password)
        if (c.valid) await expect(submit).toBeEnabled()
        else await expect(submit).toBeDisabled()
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
        if (c.verifyEnabled) await expect(verify).toBeEnabled()
        else await expect(verify).toBeDisabled()
      })
    }
    // Never verified — no sign-in happens.
  })

  test('register submit gating across phone/password partitions', async ({ page }) => {
    await page.goto('/register')
    const phone = page.getByTestId('login-phone')
    const password = page.getByTestId('login-password')
    const confirm = page.getByTestId('login-confirm-password')
    const submit = page.getByTestId('login-submit')
    await expect(submit).toBeVisible()

    for (const c of registerData.cases) {
      await test.step(`[${c.technique}] ${c.id} — ${c.note}`, async () => {
        await fillStable(phone, c.fields.phone)
        await fillStable(password, c.fields.password)
        await fillStable(confirm, c.fields.confirm)
        if (c.valid) await expect(submit).toBeEnabled()
        else await expect(submit).toBeDisabled()
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
