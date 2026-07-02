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
