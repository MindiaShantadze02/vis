import { test, expect } from '@playwright/test'
import {
  login, fillStable, bookToDetails, createSeedAppointment,
  signInSeed, restApi, readSupabaseEnv, letterName, setSmsEnabled, BOOKING_OTP, SEED,
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

  // "Before any code is sent" only means anything when a code would have been
  // sent, so this one needs the SMS add-on ON. With it off the block is still
  // enforced — by create_guest_booking, which deliberately answers with the
  // generic 'booking_failed' so an unverified caller cannot probe the blocklist
  // (covered by the DB-level test below).
  test('a blocked number is refused before any code is sent', async ({ page }) => {
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const phone = `59${String(Date.now()).slice(-7)}`

    try {
      await setSmsEnabled(true)
      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone, reason: 'e2e' }),
      })

      expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), letterName())
      await fillStable(page.getByTestId('book-phone'), phone)
      await page.getByTestId('book-submit').click()

      // Refused at the FIRST step that can refuse: the customer is told straight
      // away and never reaches the code screen.
      await expect(page.getByTestId('book-error')).toContainText(/ამ ნომრიდან/, { timeout: 20_000 })
      await expect(page.getByTestId('book-otp-code')).toHaveCount(0)

      // The point of moving the check here: no SMS was paid for and no challenge
      // was stored. booking_verifications / sms_log are superadmin-only, so
      // reading them as the owner would pass vacuously — probe the 60s per-phone
      // cooldown instead. It counts stored challenges, so if the blocked attempt
      // had written one, this next request would come back 'too_soon'.
      const { url, anonKey } = readSupabaseEnv()
      await unblockAll(ctx, [phone])
      const after = await fetch(`${url}/functions/v1/request-booking-otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ phone, org_id: orgId }),
      })
      const j = await after.json()
      expect(j.error ?? null, 'the refused attempt must not have burned the cooldown').not.toBe('too_soon')
      expect(j.ok).toBe(true)
    } finally {
      await unblockAll(ctx, [phone])
      await setSmsEnabled(false)
    }
  })

  // Needs the SMS add-on ON: the whole premise is a caller holding a VERIFIED
  // code, and create-payment only names the block ('customer_blocked' rather
  // than the generic 'booking_failed') for someone who proved phone ownership.
  test('blocking after a code was verified still stops the checkout', async () => {
    // Flipping the add-on on and back costs two extra auth round-trips on top of
    // an already HTTP-heavy test (request OTP, verify, block, checkout, unblock),
    // which pushes it past the default 60s budget.
    test.slow()
    await setSmsEnabled(true)
    // The mid-flow race: the customer already holds a verified OTP when the
    // business blocks them. create-payment must refuse rather than charge —
    // the gate the UI can no longer reach now that request-booking-otp
    // short-circuits first. Driven over HTTP for exactly that reason.
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const { url, anonKey } = readSupabaseEnv()
    const phone = `59${String(Date.now()).slice(-7)}`
    const fnHeaders = {
      'content-type': 'application/json',
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    }

    try {
      // 1. Code requested + verified while the number is still welcome.
      const req = await fetch(`${url}/functions/v1/request-booking-otp`, {
        method: 'POST', headers: fnHeaders, body: JSON.stringify({ phone, org_id: orgId }),
      })
      expect((await req.json()).ok, 'OTP request before the block').toBe(true)

      const ver = await fetch(`${url}/functions/v1/verify-booking-otp`, {
        method: 'POST', headers: fnHeaders, body: JSON.stringify({ phone, code: BOOKING_OTP }),
      })
      expect((await ver.json()).verified, 'master code accepted').toBe(true)

      // 2. The business blocks them mid-flow.
      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone, reason: 'e2e' }),
      })

      // 3. Checkout is refused, so no charge and nothing parked.
      const svc = await restApi(
        ctx, `services?org_id=eq.${orgId}&is_active=eq.true&select=id&limit=1`,
      ) as { id: string }[]
      const pay = await fetch(`${url}/functions/v1/create-payment`, {
        method: 'POST',
        headers: fnHeaders,
        body: JSON.stringify({
          purpose: 'appointment',
          org_id: orgId,
          service_id: svc[0].id,
          scheduled_at: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
          first_name: letterName(),
          phone,
          returnBaseUrl: 'http://localhost:5173',
        }),
      })
      expect(pay.status).toBe(403)
      expect((await pay.json()).error).toBe('customer_blocked')

      // (pending_bookings is superadmin-only, so the 403 above IS the assertion:
      // create-payment parks the booking only after this check passes.)
    } finally {
      await unblockAll(ctx, [phone])
      await setSmsEnabled(false)
    }
  })

  test('a blocked customer can still cancel the booking they already have', async ({ page }) => {
    // The exemption that makes the new pre-send gate safe: manage-appointment
    // asks for the code with the SERVICE ROLE key, and request-booking-otp skips
    // the blocklist for that caller. Without it a blocked customer would be
    // stranded with a booking they can neither move nor drop.
    const ctx = await signInSeed()
    const orgId = await seedOrgId(ctx)
    const phone = `59${String(Date.now()).slice(-7)}`
    // 8 days out at 10:00 business time (06:00Z).
    const when = new Date(Date.now() + 8 * 86_400_000)
    when.setUTCHours(6, 0, 0, 0)

    let apptId: string | null = null
    try {
      // Booked first, blocked second — the trigger refuses the owner insert too,
      // so the order matters.
      apptId = await createSeedAppointment({
        firstName: letterName(), phone, scheduledAt: when.toISOString(),
      })
      await restApi(ctx, 'blocked_customers', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, phone, reason: 'e2e' }),
      })

      await page.goto(`/manage/${apptId}`)
      await page.getByTestId('manage-cancel').click()

      // The code still arrives despite the block…
      const code = page.getByTestId('manage-otp-code')
      await expect(code).toBeVisible({ timeout: 20_000 })
      await code.fill(BOOKING_OTP)
      await page.getByTestId('manage-otp-submit').click()

      // …and the cancellation goes through.
      await expect.poll(async () => {
        const rows = await restApi(ctx, `appointments?id=eq.${apptId}&select=status`) as { status: string }[]
        return rows[0]?.status
      }, { timeout: 20_000 }).toBe('cancelled')
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
