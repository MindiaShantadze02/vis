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
  // Required consent to Privacy Policy + Terms (gates sign-up).
  await page.getByTestId('register-consent').locator('input').check()
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
      // Step 3 requires ticking the Privacy Policy + Terms consent before submit.
      await page.getByTestId('book-consent').locator('input').check()
      return true
    }
  }
  return false
}

/** A short, unique label so created rows are easy to spot and clean up. */
export function tag(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-6)}`
}

/**
 * A unique, letters-only first name for booking/appointment tests. Customer
 * names must pass isValidPersonName (no digits), so we map the clock's digits
 * to letters — keeping it unique per run while staying a valid person name.
 */
export function letterName(): string {
  // Map each clock digit to a letter so the whole name is letters-only (no digit
  // may appear — isValidPersonName rejects them).
  const letters = Date.now().toString().split('').map(d => 'abcdefghij'[Number(d)]).join('')
  return `Etest${letters}`
}

/**
 * Book a public in-person appointment end to end, leaving a real *pending*
 * appointment on the seeded org under `firstName`. Callers identify/clean it up
 * later via openApptByName. Asserts a bookable slot exists this week.
 */
export async function bookPending(page: Page, firstName: string): Promise<void> {
  const found = await bookToDetails(page)
  expect(found, 'expected an open day with a free slot this week').toBeTruthy()
  await fillStable(page.getByTestId('book-first-name'), firstName)
  // A unique phone per booking so back-to-back bookings don't trip the per-phone
  // OTP resend rate limit ('too_soon'), which would hide the verification step.
  await fillStable(page.getByTestId('book-phone'), uniquePhone())
  await expect(page.getByTestId('book-submit')).toBeEnabled()
  await page.getByTestId('book-submit').click()
  await passBookingOtp(page)
  await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })
}

/**
 * On the dashboard overview, search for an appointment by customer name and open
 * its detail dialog. Assumes the caller is already logged in.
 */
export async function openApptByName(page: Page, name: string): Promise<void> {
  await page.goto('/dashboard')
  const search = page.getByTestId('appt-search')
  await search.waitFor({ state: 'visible', timeout: 20_000 })
  await fillStable(search, name)
  const row = page.getByTestId('appt-row').filter({ hasText: name })
  await expect(row.first()).toBeVisible({ timeout: 20_000 })
  await row.first().click()
  await expect(page.getByTestId('appt-erase')).toBeVisible()
}

/**
 * Clean up a test appointment by driving it to a terminal state, so it drops out
 * of the org's monthly tier count (cancelled/rejected are excluded). Cancels an
 * approved one or rejects a pending one — whichever action the dialog offers.
 * The row itself remains (a guest booking can't be hard-deleted client-side),
 * matching booking.spec's documented persistence.
 */
export async function cancelAppt(page: Page, name: string): Promise<void> {
  await openApptByName(page, name)
  const cancel = page.getByTestId('appt-cancel')
  const reject = page.getByTestId('appt-reject')
  if (await cancel.count()) {
    await cancel.click()
    await page.getByTestId('appt-confirm-cancel').click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 })
  } else if (await reject.count()) {
    await reject.click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 })
  }
}
