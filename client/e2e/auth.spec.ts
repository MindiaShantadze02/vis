import { test, expect } from '@playwright/test'
import { login, register, uniquePhone, SEED } from './helpers'

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
    await expect(page.getByTestId('login-error')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('logout returns to the login page', async ({ page }) => {
    await login(page)
    await page.getByTestId('logout-btn').click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('a new phone signup lands on onboarding', async ({ page }) => {
    // sms_autoconfirm: registration returns a live session with no OTP step.
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
    await expect(page.getByTestId('login-error')).toBeVisible()
  })

  test('register submit is disabled on invalid phone or mismatched passwords', async ({ page }) => {
    await page.goto('/register')
    const submit = page.getByTestId('login-submit')

    await page.getByTestId('login-phone').fill('123')            // invalid phone
    await page.getByTestId('login-password').fill('password123')
    await page.getByTestId('login-confirm-password').fill('password123')
    await expect(submit).toBeDisabled()

    await page.getByTestId('login-phone').fill('599123456')      // valid phone now
    await page.getByTestId('login-confirm-password').fill('different')  // mismatch
    await expect(submit).toBeDisabled()
  })

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

  test('forgot-password: send is disabled until the phone is valid', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-forgot-password').click()
    await expect(page).toHaveURL(/\/forgot-password/)
    await expect(page.getByTestId('forgot-send')).toBeDisabled()
    await page.getByTestId('forgot-phone').fill('599123456')
    await expect(page.getByTestId('forgot-send')).toBeEnabled()
  })
})
