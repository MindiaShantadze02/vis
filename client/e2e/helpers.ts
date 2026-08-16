import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  // Phone-OTP gate — the master code auto-verifies then signs in.
  await passAuthOtp(page)
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
  // Phone-OTP gate — the master code auto-verifies then creates the account.
  await passAuthOtp(page)
  await expect(page).toHaveURL(/\/onboarding\/business/, { timeout: 20_000 })
}

/**
 * Complete the login/register phone-OTP step with the master code. Filling all
 * six digits auto-submits (verify → sign in/up), so no Verify click here.
 */
export async function passAuthOtp(page: Page) {
  await page.getByTestId('auth-otp-code').fill(BOOKING_OTP)
}

/** Complete the booking OTP step with the master code. */
export async function passBookingOtp(page: Page) {
  // Filling all 6 digits auto-submits (verifyAndBook fires from an effect), so
  // no Verify click here — clicking would race the navigation to the
  // confirmation page and time out on the disabled/unmounted button.
  await page.getByTestId('book-otp-code').fill(BOOKING_OTP)
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
  return pickFirstAvailableSlot(page)
}

/**
 * From the date step, walk the visible week until a day has a free slot and
 * click it, landing on the step-3 details form. Returns true if one was found.
 */
export async function pickFirstAvailableSlot(page: Page): Promise<boolean> {
  const days = page.locator('[data-testid^="book-day-"][data-disabled="false"]')
  await expect(days.first()).toBeVisible()
  for (let i = 0, n = await days.count(); i < n; i++) {
    await days.nth(i).click()
    const slot = page.getByTestId('book-slot').first()
    if (await slot.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
      await slot.click()
      // Step 3 no longer has a consent checkbox — consent is given by proceeding
      // (an inline notice under the Book button), so there's nothing to tick here.
      return true
    }
  }
  return false
}

/**
 * Enable/disable the ONLINE payment option on the seeded org by flipping
 * payment_config.bog.enabled (the Step-3 payment selector shows "online" when
 * bog or tbc is enabled; the actual checkout still goes through the
 * platform-level MOCK provider, so no real gateway is touched). Straight
 * PostgREST as the seeded owner. Off is the seed's resting default —
 * a spec that turns it on MUST restore it in afterAll, or later specs see an
 * unexpected payment-method selector in the booking flow.
 */
export async function setOnlinePayments(on: boolean): Promise<void> {
  const { url, anonKey, accessToken } = await signInSeed()
  const payment_config = {
    bog: { merchantId: '', apiKey: '', enabled: on },
    tbc: { merchantId: '', apiKey: '', enabled: false },
  }
  const update = await fetch(
    `${url}/rest/v1/organisations?slug=eq.${SEED.slug}&select=id`,
    {
      method: 'PATCH',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ payment_config }),
    },
  )
  if (!update.ok) throw new Error(`payment_config update failed: ${update.status} ${await update.text()}`)
  const rows = (await update.json()) as { id: string }[]
  if (!rows.length) throw new Error('payment_config update matched no org')
}

/**
 * Create an approved appointment for the seeded org directly via PostgREST as
 * the owner (member inserts skip the OTP/slot/normalize guards). Used by the
 * /manage specs so the appointment's phone has NO recent booking OTP — the
 * self-service flow then requests a fresh code without hitting the 60s cooldown.
 * Returns the new appointment id.
 */
export async function createSeedAppointment(opts: {
  firstName: string
  phone: string
  scheduledAt: string
  paymentMethod?: 'in_person' | 'online'
  paymentStatus?: 'unpaid' | 'paid'
}): Promise<string> {
  const { url, anonKey, accessToken } = await signInSeed()
  // Read headers (SELECT own org/services works for the owner); write headers
  // omit return=representation — we mint the ids client-side and don't read
  // customers back (no member SELECT policy on it).
  const H = { apikey: anonKey, authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }
  const org = (await (await fetch(`${url}/rest/v1/organisations?slug=eq.${SEED.slug}&select=id`, { headers: H })).json()) as { id: string }[]
  const orgId = org[0].id
  const svc = (await (await fetch(`${url}/rest/v1/services?org_id=eq.${orgId}&is_active=eq.true&select=id,duration_minutes&limit=1`, { headers: H })).json()) as { id: string; duration_minutes: number }[]

  const customerId = crypto.randomUUID()
  const appointmentId = crypto.randomUUID()
  const custRes = await fetch(`${url}/rest/v1/customers`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ id: customerId, first_name: opts.firstName, phone_number: opts.phone }),
  })
  if (!custRes.ok) throw new Error(`customer insert failed: ${custRes.status} ${await custRes.text()}`)
  const apptRes = await fetch(`${url}/rest/v1/appointments`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      id: appointmentId, org_id: orgId, service_id: svc[0].id, customer_id: customerId,
      scheduled_at: opts.scheduledAt, duration_minutes: svc[0].duration_minutes,
      status: 'approved',
      payment_method: opts.paymentMethod ?? 'in_person',
      payment_status: opts.paymentStatus ?? 'unpaid',
    }),
  })
  if (!apptRes.ok) throw new Error(`appointment insert failed: ${apptRes.status} ${await apptRes.text()}`)
  return appointmentId
}

/**
 * Read the hosted project's URL + anon key from client/.env — for Node-side
 * specs that talk straight to the GoTrue / PostgREST / Edge-Function HTTP
 * endpoints (supabase-js won't construct on Node 20).
 */
export function readSupabaseEnv(): { url: string; anonKey: string } {
  const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
  const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)![1]
  const anonKey = /VITE_SUPABASE_ANON_KEY=(\S+)/.exec(env)![1]
  return { url, anonKey }
}

/**
 * Optional service-role key, read from `SUPABASE_SERVICE_ROLE_KEY` in client/.env
 * (no VITE_ prefix, so Vite never bundles it into the browser) or from the
 * process env. Absent by default — specs that need it must skip, not fail.
 *
 * Only for state a client legitimately cannot reach. Today that is
 * `organisations.billing_status`: prevent_billing_self_update rejects owners, so
 * without this the billing-block regression can never be exercised. Everything
 * else must keep going through the owner's own credentials, or the tests stop
 * proving that RLS works.
 */
export function serviceRoleKey(): string | null {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
    return /^SUPABASE_SERVICE_ROLE_KEY=(\S+)/m.exec(env)?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Set the seed org's billing_status with the service role, which is exempt from
 * prevent_billing_self_update (the guard allows `auth.uid() IS NULL`). Callers
 * MUST restore 'active' in a finally/afterAll — leaving the seed org blocked
 * would cascade failures across the whole suite.
 */
export async function setSeedBillingStatus(status: 'active' | 'past_due' | 'suspended'): Promise<void> {
  const key = serviceRoleKey()
  if (!key) throw new Error('setSeedBillingStatus needs SUPABASE_SERVICE_ROLE_KEY')
  const { url } = readSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/organisations?slug=eq.${SEED.slug}`, {
    method: 'PATCH',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ billing_status: status }),
  })
  if (!res.ok) throw new Error(`setSeedBillingStatus(${status}) → ${res.status} ${await res.text()}`)
}

/** Password sign-in as the seeded owner; returns the URL, anon key + access token. */
export async function signInSeed(): Promise<{ url: string; anonKey: string; accessToken: string }> {
  const { url, anonKey } = readSupabaseEnv()
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ phone: `+995${SEED.phone}`, password: SEED.password }),
  })
  if (!res.ok) throw new Error(`seed owner sign-in failed: ${res.status} ${await res.text()}`)
  const { access_token } = (await res.json()) as { access_token: string }
  return { url, anonKey, accessToken: access_token }
}

export type SeedCtx = Awaited<ReturnType<typeof signInSeed>>

/**
 * PostgREST call as the seeded owner (for specs that seed/clean rows the UI
 * can't easily create). Do NOT pass `Prefer: return=representation` unless you
 * need the row back AND it's visible under the table's SELECT policy — a
 * freshly-inserted customer isn't (customers_select needs a linked appointment),
 * so requesting it back raises 42501. Returns parsed JSON, or null on empty body.
 */
export async function restApi(ctx: SeedCtx, path: string, init: RequestInit = {}) {
  const res = await fetch(`${ctx.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ctx.anonKey,
      authorization: `Bearer ${ctx.accessToken}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
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
 * Leave a real upcoming appointment on the seeded org under `firstName`, for the
 * dashboard specs that drive the approved→cancelled/no_show transitions.
 * Callers identify/clean it up later via openApptByName.
 *
 * Inserted straight through PostgREST rather than booked through the UI: free
 * services were removed (2026-08-12), so every public booking pays online and
 * payment-webhook creates it 'approved'.
 *
 * Scheduled 8 days out at 10:00 business time, like manage.spec's futureSlotIso
 * — far enough ahead to stay upcoming, and inside the calendar's forward scan.
 */
export async function seedUpcomingAppointment(firstName: string): Promise<string> {
  const at = new Date(Date.now() + 8 * 86_400_000)
  at.setUTCHours(6, 0, 0, 0)
  return createSeedAppointment({
    firstName,
    // A unique phone per row so specs never collide on customer lookup.
    phone: uniquePhone(),
    scheduledAt: at.toISOString(),
  })
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
  await expect(page.getByRole('dialog')).toBeVisible()
}

/**
 * Erase a client's PII (Art. 16) from the dedicated Clients screen — the erase
 * action moved off the appointment drawer. Searches by name, confirms the
 * destructive dialog, and waits for the row to anonymize out of the results.
 */
export async function eraseClientByName(page: Page, name: string): Promise<void> {
  await page.goto('/dashboard/clients')
  const search = page.getByTestId('clients-search')
  await search.waitFor({ state: 'visible', timeout: 20_000 })
  await fillStable(search, name)
  const row = page.getByTestId('client-row').filter({ hasText: name })
  await expect(row.first()).toBeVisible({ timeout: 20_000 })
  await row.first().getByTestId('client-erase').click()
  await page.getByTestId('confirm-dialog-confirm').click()
  // The shared customer record is anonymized (name → "erased"), so the original
  // name drops out of the list.
  await expect(page.getByTestId('client-row').filter({ hasText: name })).toHaveCount(0, { timeout: 20_000 })
}

/**
 * Clean up a test appointment by cancelling it, so it drops out of the org's
 * billable count (cancelled is excluded). The row itself remains (a guest
 * booking can't be hard-deleted client-side), matching booking.spec's
 * documented persistence. A no-op when the appointment is already terminal.
 */
export async function cancelAppt(page: Page, name: string): Promise<void> {
  await openApptByName(page, name)
  const cancel = page.getByTestId('appt-cancel')
  if (await cancel.count()) {
    await cancel.click()
    await page.getByTestId('appt-confirm-cancel').click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 })
  }
}
