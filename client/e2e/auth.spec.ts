import { test, expect } from '@playwright/test'
import { login, register, passAuthOtp, uniquePhone, SEED } from './helpers'

test.describe('Authentication', () => {
  test('owner can log in and reach the dashboard', async ({ page }) => {
    await login(page)
    // Seeded org name is shown in the sidebar.
    await expect(page.getByText(SEED.orgName)).toBeVisible()
  })

  test('wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-phone').fill(SEED.phone)
    await page.getByTestId('login-password').fill('definitely-wrong')
    await page.getByTestId('login-submit').click()
    // Pass the OTP gate; the bad password is only rejected at sign-in, which
    // sends us back to the form with an error.
    await passAuthOtp(page)
    await expect(page.getByTestId('login-error')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout returns to the login page', async ({ page }) => {
    await login(page)
    await page.getByTestId('logout-btn').click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('a new phone signup lands on onboarding', async ({ page }) => {
    // register() passes the phone-OTP gate (master code); sms_autoconfirm then
    // returns a live session, landing on onboarding.
    await register(page, uniquePhone())
    await expect(page.getByRole('heading', { name: 'ბიზნესის ინფო' })).toBeVisible()
  })
})

test.describe('Authentication — edge cases', () => {
  test('login with an unknown phone shows an error', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-phone').fill('500000000')
    await page.getByTestId('login-password').fill('password123')
    await page.getByTestId('login-submit').click()
    // OTP verifies (any phone can request a code); the unknown account is only
    // rejected at sign-in.
    await passAuthOtp(page)
    await expect(page.getByTestId('login-error')).toBeVisible()
  })

  test('registering an already-used phone is rejected', async ({ page }) => {
    // Signing up an existing phone returns empty identities → "phone taken".
    // No new user is created.
    await page.goto('/register')
    await page.getByTestId('login-phone').fill(SEED.phone)
    await page.getByTestId('login-password').fill('password123')
    await page.getByTestId('login-confirm-password').fill('password123')
    // Required consent to Privacy Policy + Terms (gates sign-up).
    await page.getByTestId('register-consent').locator('input').check()
    await page.getByTestId('login-submit').click()
    // OTP verifies, then signUp reports the phone is already taken.
    await passAuthOtp(page)
    await expect(page.getByTestId('login-error')).toBeVisible()
  })

  // Login/register submit gating (phone + password partitions) is data-driven
  // now — see e2e/data/auth-login.json, e2e/data/auth-register.json +
  // e2e/data-driven/auth.spec.ts.

  test('unauthenticated access to a protected route redirects to login', async ({ page }) => {
    await page.goto('/dashboard/settings/services')
    await expect(page).toHaveURL(/\/login/)
  })

  test('an authenticated user visiting /login is redirected away', async ({ page }) => {
    await login(page)
    await page.goto('/login')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('the login page links to forgot-password', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-forgot-password').click()
    await expect(page).toHaveURL(/\/forgot-password/)
    // Send gating across phone partitions is data-driven — see
    // e2e/data-driven/forgot-password.spec.ts.
  })
})
