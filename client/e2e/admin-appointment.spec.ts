import { test, expect } from '@playwright/test'
import { login, signInSeed, restApi, letterName, uniquePhone, SEED } from './helpers'

/**
 * Owner-side appointment creation (re-added 20260903120000, after being removed
 * with recurring series on 2026-08-13).
 *
 * The reason it came back is the SMS add-on: a business that already agreed the
 * time with the customer on the phone should be able to write it down without
 * paying ₾0.7 for a confirmation the customer has effectively had. Both of those
 * consequences hang off one thing — the DB stamping source='admin' /
 * sms_billable=false because a member did the insert — so that stamp is what
 * this spec actually checks, not the absence of a text.
 *
 * Self-cleaning: the booking is cancelled in a `finally`. Appointments have no
 * member DELETE policy (history is protected), so cancelling is the cleanup.
 */
test.describe('Calendar — add appointment', () => {
  test('an owner books on a customer\'s behalf: no SMS fee, stamped as admin', async ({ page }) => {
    const ctx = await signInSeed()
    const firstName = letterName()
    const phone = uniquePhone()
    let apptId: string | null = null

    try {
      await login(page)
      await page.goto('/dashboard/calendar')

      await page.getByTestId('cal-add-btn').click()
      await expect(page.getByTestId('cal-add-save')).toBeVisible()

      // Service and day/time come pre-filled from the open week; only the
      // customer's details need typing.
      await page.getByTestId('cal-add-first-name').fill(firstName)
      await page.getByTestId('cal-add-phone').fill(phone)
      await page.getByTestId('cal-add-save').click()

      // The drawer closes on success.
      await expect(page.getByTestId('cal-add-save')).toBeHidden({ timeout: 20_000 })

      // The row exists, and carries the two stamps the billing and SMS rules
      // both read. Matching on the phone rather than the name: names repeat.
      type Row = {
        id: string; status: string; source: string
        sms_billable: boolean; payment_method: string
      }
      const query =
        'appointments?select=id,status,source,sms_billable,payment_method,customers!inner(phone_number)'
        + `&customers.phone_number=eq.${phone}`

      await expect
        .poll(async () => ((await restApi(ctx, query)) as Row[]).length, { timeout: 20_000 })
        .toBe(1)

      const rows = (await restApi(ctx, query)) as Row[]
      apptId = rows[0].id
      expect(rows[0].source, 'a member inserted it, so it is an admin booking').toBe('admin')
      expect(rows[0].sms_billable, 'admin bookings never carry the SMS fee').toBe(false)
      // Agreed by phone already — it lands confirmed and settles in person.
      expect(rows[0].status).toBe('approved')
      expect(rows[0].payment_method).toBe('in_person')
    } finally {
      if (apptId) {
        await restApi(ctx, `appointments?id=eq.${apptId}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }),
        })
      }
    }
  })

  test('the add form validates the customer fields inline', async ({ page }) => {
    await login(page)
    await page.goto('/dashboard/calendar')
    await page.getByTestId('cal-add-btn').click()

    // Nothing is disabled for validation — clicking save flags the fields.
    await page.getByTestId('cal-add-save').click()
    await expect(page.getByTestId('cal-add-first-name')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('cal-add-phone')).toHaveAttribute('aria-invalid', 'true')

    // A name is not enough — the phone is still required.
    await page.getByTestId('cal-add-first-name').fill(letterName())
    await page.getByTestId('cal-add-save').click()
    await expect(page.getByTestId('cal-add-phone')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('cal-add-save')).toBeVisible()

    // Nothing was created.
    expect(page.url()).toContain('/dashboard/calendar')
  })
})

/**
 * The seed org's resting state. If a spec leaves the SMS add-on on, every later
 * booking spec starts waiting for a code field, so this guards the contract the
 * setSmsEnabled helper documents.
 */
test('the seeded org has the SMS add-on off', async () => {
  const ctx = await signInSeed()
  const rows = (await restApi(
    ctx, `organisations?slug=eq.${SEED.slug}&select=sms_enabled`,
  )) as { sms_enabled: boolean }[]
  expect(rows[0].sms_enabled).toBe(false)
})
