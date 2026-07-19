import { test, expect, type Page } from '@playwright/test'
import {
  login, bookToDetails, openApptByName, passBookingOtp, fillStable,
  letterName, uniquePhone, setOnlinePayments, setServiceDeposit,
  signInSeed, restApi, SEED, eraseClientByName, readSupabaseEnv,
} from './helpers'

/**
 * Deposits (Phase 2, migrations 089/090) end to end against the MOCK payment
 * provider: a service with a deposit forces the online path on the booking page
 * (pay-in-person would bypass the deposit), the customer is charged only the
 * deposit through the mock gateway, and payment-webhook materialises the
 * appointment as approved + payment_status='deposit_paid'.
 *
 * NOTE: a successful run leaves a deposit_paid appointment + customer on the
 * seeded org until the erase step (guests can't self-delete; same persistence
 * as booking.spec / refund.spec).
 */
test.describe('Deposits — booking', () => {
  // A 50% deposit on the seed services + online enabled. Both restored after,
  // or later booking specs would see a forced-online deposit flow.
  test.beforeAll(async () => {
    await setOnlinePayments(true)
    await setServiceDeposit('percent', 50)
  })
  test.afterAll(async () => {
    await setServiceDeposit(null, null)
    await setOnlinePayments(false)
  })

  const dialog = (page: Page) => page.getByRole('dialog')

  test('a deposit forces online payment and settles as deposit_paid', async ({ page }) => {
    const name = letterName()

    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), uniquePhone())

    // Deposit required → the deposit breakdown shows and pay-in-person is NOT
    // offered (the method toggle is hidden; only online remains).
    await expect(page.getByTestId('book-deposit-breakdown')).toBeVisible()
    await expect(page.getByTestId('book-deposit-amount')).toBeVisible()
    await expect(page.getByTestId('book-pay-in_person')).toHaveCount(0)

    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)

    // OTP verified → create-payment parks the booking (deposit amount) and
    // redirects to the mock checkout; success drives payment-webhook.
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })

    // Server state: the appointment exists, approved, with a partial deposit.
    const ctx = await signInSeed()
    const rows = (await restApi(
      ctx,
      `appointments?select=status,payment_status,customers!inner(first_name)&customers.first_name=eq.${name}`,
    )) as { status: string; payment_status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('approved')
    expect(rows[0].payment_status).toBe('deposit_paid')

    // Erase the guest's PII (Art. 16) from the Clients screen — doubles as cleanup.
    await login(page)
    await eraseClientByName(page, name)
  })
})

/**
 * Deposit config — backend validation (migration 091). The DB CHECK constraints
 * reject out-of-range deposit_value at write time (a direct PostgREST / public-API
 * write bypasses the client validator). Pure backend e2e via PostgREST as the
 * owner — no UI. computeDeposit's runtime CLAMP is unit-tested separately
 * (deposit.test.ts); this proves the data-integrity guard.
 *
 * Technique: boundary-value analysis on deposit_value per deposit_type —
 *   percent: valid [0..100], invalid <0 and >100
 *   fixed:   valid [0..∞),  invalid <0
 */
test.describe('Deposit config — backend validation', () => {
  // Any deposit we manage to write is cleared after, so later booking specs
  // aren't unexpectedly forced online.
  test.afterAll(async () => {
    await setServiceDeposit(null, null)
  })

  async function patchSeedServiceDeposit(depositType: string, depositValue: number) {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    // restApi throws on any non-2xx (a rejected CHECK is a 400) — callers assert
    // resolve/reject accordingly.
    return restApi(ctx, `services?org_id=eq.${org[0].id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ deposit_type: depositType, deposit_value: depositValue }),
    })
  }

  test('percent deposits are constrained to 0..100', async () => {
    // Below-boundary and above-boundary are rejected by the CHECK.
    await expect(patchSeedServiceDeposit('percent', -1)).rejects.toThrow()
    await expect(patchSeedServiceDeposit('percent', 101)).rejects.toThrow()
    // The two boundaries themselves are accepted.
    await expect(patchSeedServiceDeposit('percent', 0)).resolves.not.toThrow()
    await expect(patchSeedServiceDeposit('percent', 100)).resolves.not.toThrow()
  })

  test('fixed deposits reject negatives, accept zero', async () => {
    await expect(patchSeedServiceDeposit('fixed', -1)).rejects.toThrow()
    await expect(patchSeedServiceDeposit('fixed', 0)).resolves.not.toThrow()
  })
})

/**
 * Deposit bypass guard (2026-07-19 security review, F1). The "deposit forces
 * online prepayment" rule was enforced only client-side. A guest with an OTP
 * could call the anon RPC create_guest_booking directly and get a confirmed
 * in-person/unpaid booking for a deposit-required service, skipping the deposit.
 * normalize_guest_appointment (the first BEFORE INSERT trigger) now rejects that
 * path with 'deposit_required' — so knowing the RPC exists buys nothing.
 */
test.describe('Deposit bypass guard', () => {
  test.afterAll(async () => {
    await setServiceDeposit(null, null)
  })

  test('a deposit-required service rejects the direct in-person guest RPC', async () => {
    await setServiceDeposit('percent', 50)
    const { url, anonKey } = readSupabaseEnv()
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    // A priced service so the percent deposit resolves > 0 (free services can't
    // carry a deposit, and would legitimately be allowed through).
    const svc = (await restApi(
      ctx,
      `services?org_id=eq.${org[0].id}&is_active=eq.true&price=gt.0&select=id&limit=1`,
    )) as { id: string }[]
    expect(svc.length, 'seed org needs a priced service').toBe(1)

    // Straight anon RPC call, bypassing the booking UI's forced-online path.
    const res = await fetch(`${url}/rest/v1/rpc/create_guest_booking`, {
      method: 'POST',
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_org_id: org[0].id,
        p_service_id: svc[0].id,
        p_scheduled_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        p_first_name: 'Bypasser',
        p_last_name: null,
        p_phone: uniquePhone(),
      }),
    })
    expect(res.status, 'the guarded RPC must reject, not create').toBeGreaterThanOrEqual(400)
    expect(await res.text()).toContain('deposit_required')
  })
})

/**
 * No-show (migration 089): an owner marks an approved appointment as a no-show —
 * a first-class status distinct from cancel (the slot was consumed, so it still
 * counts toward usage, and any deposit is kept per policy).
 */
test.describe('No-show', () => {
  const dialog = (page: Page) => page.getByRole('dialog')

  test('owner marks an approved appointment as no-show', async ({ page }) => {
    const name = letterName()

    // Resting default: in-person + auto-approve, so this books an approved
    // appointment without any payment step.
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), name)
    await fillStable(page.getByTestId('book-phone'), uniquePhone())
    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })

    await login(page)
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-approved')).toBeVisible()

    await dialog(page).getByTestId('appt-no-show').click()
    await expect(dialog(page)).toBeHidden({ timeout: 20_000 })

    // Reopen: the status is now no_show.
    await openApptByName(page, name)
    await expect(dialog(page).getByTestId('status-no_show')).toBeVisible()

    // Cleanup: erase the guest PII from the Clients screen.
    await eraseClientByName(page, name)
  })
})
