import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Fill a field and confirm the value stuck, retrying if it didn't. Onboarding and
 * booking steps animate in with framer-motion; a fill fired mid-transition can be
 * dropped, so we verify and re-fill until the value holds.
 */
export async function fillStable(locator: Locator, value: string) {
  await expect(async () => {
    await locator.fill(value)
    await expect(locator).toHaveValue(value)
  }).toPass({ timeout: 10_000 })
}

/**
 * Seeded owner account + org (created via the onboarding flow, see the project's
 * test-accounts notes). Used by every authenticated spec so we don't create a
 * fresh org each run.
 */
export const SEED = {
  phone: '555108509',
  password: 'password123',
  orgName: 'Test Appointments Studio',
  slug: 'test-appointments-studio',
  service: 'Consultation',
} as const

/** Temporary booking-OTP master code accepted on the hosted backend for testing. */
export const BOOKING_OTP = '000000'

/**
 * A unique, valid Georgian mobile number ("5XXXXXXXX") for signup tests. Derived
 * from the clock so repeated runs don't collide within a run. NOTE: each accepted
 * signup leaves a throwaway auth user behind unless the spec self-cleans by
 * deleting the account (see onboarding.spec.ts).
 */
export function uniquePhone(): string {
  const suffix = String(Date.now() % 100_000_000).padStart(8, '0')
  return `5${suffix}`
}

/** Log in as the seeded owner (or any phone/password) and land on the dashboard. */
export async function login(page: Page, phone: string = SEED.phone, password: string = SEED.password) {
  await page.goto('/login')
  await page.getByTestId('login-phone').fill(phone)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
}

/** Register a brand-new phone account. Lands on onboarding (no org yet). */
export async function register(page: Page, phone: string, password = 'password123') {
  await page.goto('/register')
  await page.getByTestId('login-phone').fill(phone)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-confirm-password').fill(password)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/onboarding\/business/, { timeout: 20_000 })
}

/** Complete the booking OTP step with the master code. */
export async function passBookingOtp(page: Page) {
  await page.getByTestId('book-otp-code').fill(BOOKING_OTP)
  await page.getByTestId('book-otp-verify').click()
}

/**
 * Drive the public booking wizard from the org page through service + the first
 * day/slot with availability, leaving the browser on the step-3 details form.
 * Returns true if a bookable slot was found this week.
 */
export async function bookToDetails(page: Page, slug = SEED.slug): Promise<boolean> {
  await page.goto(`/book/${slug}`)
  const service = page.getByTestId('book-service').first()
  await service.waitFor({ state: 'visible', timeout: 30_000 })
  await service.click()

  const days = page.locator('[data-testid^="book-day-"][data-disabled="false"]')
  await expect(days.first()).toBeVisible()
  for (let i = 0, n = await days.count(); i < n; i++) {
    await days.nth(i).click()
    const slot = page.getByTestId('book-slot').first()
    if (await slot.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
      await slot.click()
      return true
    }
  }
  return false
}

/** A short, unique label so created rows are easy to spot and clean up. */
export function tag(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-6)}`
}
