import { test, expect } from '@playwright/test'
import {
  login, fillStable, bookToDetails, passBookingOtp,
  signInSeed, restApi, letterName, setPaymentMethods, SEED,
  type SeedCtx,
} from './helpers'

/**
 * Per-org customer blocklist (migration 20260819120000).
 *
 * The point of this feature is that it is enforced by the DATABASE, not the
 * booking form — so the specs here deliberately attack it from both sides: the
 * owner's UI, and a raw PostgREST insert that skips the UI entirely.
 *
 * Every test blocks a phone that is unique to the run and removes it in a
 * finally/afterEach. A leaked block row would silently bar that number from the
 * seeded org for every later run.
 */

/** Remove any blocklist rows for these phones on the seeded org. */
async function unblockAll(ctx: SeedCtx, phones: string[]) {
  for (const phone of phones) {
    await restApi(ctx, `blocked_customers?phone=eq.${phone}`, { method: 'DELETE' })
      .catch(() => { /* best-effort cleanup */ })
  }
}

async function seedOrgId(ctx: SeedCtx): Promise<string> {
  const rows = await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`) as { id: string }[]
  return rows[0].id
}

test.describe('Blocked customers', () => {
  test('an owner blocks a number from the dashboard and the blocklist reflects it', async ({ page }) => {
    const ctx = await signInSeed()
    // Unique per run, valid Georgian mobile — never a real customer's number.
    const phone = `59${String(Date.now()).slice(-7)}`

    try {
      await login(page)
      await page.goto('/dashboard/clients')

      await page.getByTestId('clients-tab-blocked').click()
      await page.getByTestId('block-add').click()

      await fillStable(page.getByTestId('block-phone'), phone)
      await fillStable(page.getByTestId('block-reason'), 'e2e: repeated no-shows')
      await page.getByTestId('block-save').click()

      // The row lands in the blocklist with its reason.
      const row = page.getByTestId('blocked-row').filter({ hasText: phone })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toContainText('repeated no-shows')

      // And it really is a row, not just optimistic UI.
      const stored = await restApi(ctx, `blocked_customers?phone=eq.${phone}&select=phone,reason`) as
        { phone: string; reason: string }[]
      expect(stored).toHaveLength(1)

      // Unblocking removes it again.
      await row.getByTestId('blocked-unblock').click()
      await page.getByTestId('confirm-dialog-confirm').click()
      await expect(page.getByTestId('blocked-row').filter({ hasText: phone })).toHaveCount(0, { timeout: 20_000 })

      const after = await restApi(ctx, `blocked_customers?phone=eq.${phone}&select=phone`) as unknown[]
      expect(after).toHaveLength(0)
    } finally {
      await unblockAll(ctx, [phone])
    }
  })

  test('a blocked number is refused at the booking form', async ({ page }) => {
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const phone = `59${String(Date.now()).slice(-7)}`

    try {
      // On-site payment only, so the booking is a direct client-side insert and
      // the refusal comes from the trigger rather than from create-payment. Both
      // paths are gated; this is the one a spec can drive without a gateway.
      await setPaymentMethods({ online: false, inPerson: true })

      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone, reason: 'e2e' }),
      })

      expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), letterName())
      await fillStable(page.getByTestId('book-phone'), phone)
      await page.getByTestId('book-submit').click()
      // The block sits BEHIND the OTP gate on purpose — proving you own the
      // phone is what earns you the real answer.
      await passBookingOtp(page)

      await expect(page.getByTestId('book-error')).toContainText(/ამ ნომრიდან/, { timeout: 20_000 })

      // Nothing was created.
      const appts = await restApi(
        ctx,
        `appointments?org_id=eq.${orgId}&select=id,customers!inner(phone_number)&customers.phone_number=eq.${phone}`,
      ) as unknown[]
      expect(appts).toHaveLength(0)
    } finally {
      await unblockAll(ctx, [phone])
      await setPaymentMethods({ online: true, inPerson: true })
    }
  })

  test('a blocked number never reaches the payment gateway', async ({ page }) => {
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const phone = `59${String(Date.now()).slice(-7)}`

    try {
      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone, reason: 'e2e' }),
      })

      // Online is the seed's default, so this is the checkout path. create-payment
      // refuses AFTER the OTP check and BEFORE parking the booking, so the
      // customer is never charged and no pending_bookings row is left behind.
      expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), letterName())
      await fillStable(page.getByTestId('book-phone'), phone)
      await page.getByTestId('book-submit').click()
      await passBookingOtp(page)

      await expect(page.getByTestId('book-error')).toContainText(/ამ ნომრიდან/, { timeout: 20_000 })
      await expect(page).not.toHaveURL(/\/pay\/mock/)
    } finally {
      await unblockAll(ctx, [phone])
    }
  })

  test('the block is enforced in the database, not the client', async () => {
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const phone = `59${String(Date.now()).slice(-7)}`

    try {
      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone }),
      })

      // The owner's own PostgREST insert bypasses the booking form entirely and
      // is exempt from the OTP gate (member inserts are). It must STILL be
      // refused: the blocklist has no trusted-caller bypass.
      const svc = await restApi(
        ctx, `services?org_id=eq.${orgId}&is_active=eq.true&select=id,duration_minutes&limit=1`,
      ) as { id: string; duration_minutes: number }[]
      const customerId = crypto.randomUUID()
      await restApi(ctx, 'customers', {
        method: 'POST',
        body: JSON.stringify({ id: customerId, first_name: letterName(), phone_number: phone }),
      })

      const attempt = restApi(ctx, 'appointments', {
        method: 'POST',
        body: JSON.stringify({
          org_id: orgId,
          service_id: svc[0].id,
          customer_id: customerId,
          scheduled_at: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
          duration_minutes: svc[0].duration_minutes,
          status: 'approved',
          payment_method: 'in_person',
          payment_status: 'unpaid',
        }),
      })
      await expect(attempt).rejects.toThrow(/customer_blocked/)
    } finally {
      await unblockAll(ctx, [phone])
    }
  })

  test('the blocklist normalises what the owner types', async () => {
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const digits = `59${String(Date.now()).slice(-7)}`
    // Same number, written the way someone would paste it out of their phone.
    const typed = `+995 ${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`

    try {
      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone: typed }),
      })
      const stored = await restApi(ctx, `blocked_customers?phone=eq.${digits}&select=phone`) as
        { phone: string }[]
      expect(stored).toHaveLength(1)
      expect(stored[0].phone).toBe(digits)

      // A number that can't be normalised is refused outright rather than
      // stored in a shape nothing will ever match.
      const junk = restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone: '12345' }),
      })
      await expect(junk).rejects.toThrow(/invalid_phone|violates check constraint/)
    } finally {
      await unblockAll(ctx, [digits])
    }
  })

  test('one org cannot block a number on another org', async () => {
    const ctx = await signInSeed()

    // The RLS WITH CHECK ties the row's org_id to the caller's memberships, so a
    // fabricated org_id is refused — without it, any owner could bar a
    // competitor's customers.
    const attempt = restApi(ctx, 'blocked_customers', {
      method: 'POST',
      body: JSON.stringify({
        org_id: '00000000-0000-0000-0000-000000000001',
        phone: '555000111',
      }),
    })
    await expect(attempt).rejects.toThrow(/42501|violates row-level security|foreign key/)
  })
})
