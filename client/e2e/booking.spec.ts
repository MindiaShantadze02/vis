import { test, expect } from '@playwright/test'
import {
  passBookingOtp, fillStable, bookToDetails, pickFirstAvailableSlot,
  signInSeed, restApi, letterName, uniquePhone, setPaymentMethods, setSmsEnabled, SEED,
} from './helpers'

/** Open the booking wizard on the date step (service selected, week strip visible). */
async function openDateStep(page: import('@playwright/test').Page) {
  await page.goto(`/book/${SEED.slug}`)
  const service = page.getByTestId('book-service').first()
  await service.waitFor({ state: 'visible', timeout: 30_000 })
  await service.click()
  await expect(page.locator('[data-testid^="book-day-"]').first()).toBeVisible()
}

test.describe('Public booking', () => {
  // NOTE: a successful run creates a real appointment + customer on the
  // seeded org (guests can't self-delete). See e2e/README.md.
  test('a guest books and pays online end to end and it auto-approves', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()

    // The quiet "Powered by Vis" growth-loop footer is on every booking page,
    // and the oversized Vis wordmark closes the branded sidebar.
    await expect(page.getByTestId('powered-by-vis')).toBeVisible()
    await expect(page.getByTestId('booking-vis-watermark')).toBeVisible()
    // The language switcher lives in that same footer, not above the steps.
    await expect(page.getByTestId('language-switcher-btn')).toBeVisible()

    // Step 3 — customer details. A priced service (the seeded Consultation is
    // ₾50) with on-site enabled shows the Online / On site selector, and Online
    // is preselected — so Book proceeds straight to payment after verification.
    // Name must be letters only (isValidPersonName rejects digits).
    await fillStable(page.getByTestId('book-first-name'), 'Nino')
    await fillStable(page.getByTestId('book-phone'), '599112233')
    await expect(page.getByTestId('book-submit')).toBeEnabled()
    await page.getByTestId('book-submit').click()

    // Phone verification with the master OTP.
    await passBookingOtp(page)

    // OTP verified → create-payment parks the booking and redirects to the mock
    // gateway; a successful charge drives payment-webhook, which creates the
    // appointment (auto-approved) and the return page routes to its confirmation.
    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 20_000 })
    await page.getByTestId('mock-pay-success').click()
    await expect(page).toHaveURL(/\/payment-return/, { timeout: 20_000 })
    await page.getByTestId('payment-return-primary').click()

    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /ჯავშანი დადასტურებულია/ })).toBeVisible()

    // "Book another" rewinds the saved draft: the customer's details and service
    // survive, but the slot they just took is cleared and the flow reopens on
    // the date/time step — resuming on the details form would resubmit the same
    // slot and fail with 'slot_taken'.
    await page.getByTestId('confirm-book-another').click()
    await expect(page).toHaveURL(new RegExp(`/book/${SEED.slug}`))
    await expect(page.getByTestId('book-week-strip')).toBeVisible()
    await expect(page.getByTestId('book-first-name')).toHaveCount(0)

    // Picking a new slot returns to step 3 with the details still filled in.
    // Stop here — submitting would create a second real appointment on the seed.
    expect(await pickFirstAvailableSlot(page)).toBeTruthy()
    await expect(page.getByTestId('book-first-name')).toHaveValue('Nino')
    await expect(page.getByTestId('book-phone')).toHaveValue('599112233')
  })

  test('the form holds one height across steps (no layout shift)', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}`)
    const service = page.getByTestId('book-service').first()
    await service.waitFor({ state: 'visible', timeout: 30_000 })

    const height = () => page.evaluate(() => Math.round(document.documentElement.scrollHeight))
    // Let the service list settle first — its photos land after the markup, and
    // that final height is the floor every later step is held to.
    let settled = await height()
    await expect.poll(async () => {
      const now = await height()
      const stable = now === settled
      settled = now
      return stable
    }, { timeout: 15_000 }).toBe(true)

    await service.click()
    await expect(page.getByTestId('book-week-strip')).toBeVisible()
    // The date step is shorter than the service list, but the page must not shrink.
    await expect.poll(height, { timeout: 5_000 }).toBe(settled)
  })

  test('the sidebar summary only reports steps already left behind', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}`)
    const service = page.getByTestId('book-service').filter({ hasText: SEED.service }).first()
    await service.waitFor({ state: 'visible', timeout: 30_000 })

    const summary = page.getByTestId('booking-summary')
    const rows = page.getByTestId('booking-summary-row')

    // Choosing the service: nothing to report yet.
    await expect(summary).toHaveCount(0)

    // On the date step it reports the service — one row, no date/time yet.
    await service.click()
    await expect(page.getByTestId('book-week-strip')).toBeVisible()
    await expect(summary).toBeVisible()
    await expect(summary).toContainText(SEED.service)
    await expect(rows).toHaveCount(1)

    // Going back to re-pick a service must clear it again — it used to stay
    // ticked off beside the very list you were choosing from.
    await page.getByTestId('book-back').click()
    await expect(page.getByTestId('book-service').first()).toBeVisible()
    await expect(summary).toHaveCount(0)
  })

  test('an unknown org slug shows a not-found state', async ({ page }) => {
    await page.goto('/book/this-slug-does-not-exist-xyz')
    // BookingLayout renders an empty/unavailable state rather than the wizard.
    await expect(page.getByTestId('book-service')).toHaveCount(0)
  })

  // --- edge cases ---
  // Step-3 field gating (pairwise/BVA/error-guessing) is data-driven now — see
  // e2e/data/booking-customer.json + e2e/data-driven/booking-customer.spec.ts.

  // The OTP step only exists for orgs that bought the SMS add-on, so this test
  // turns it on and MUST put it back — off is the seed's resting state and
  // every other booking spec assumes it.
  test('a wrong OTP is rejected and stays on the verification step', async ({ page }) => {
    await setSmsEnabled(true)
    try {
      expect(await bookToDetails(page)).toBeTruthy()
      await fillStable(page.getByTestId('book-first-name'), 'Nino')
      await fillStable(page.getByTestId('book-phone'), '599445566')
      await page.getByTestId('book-submit').click()

      // Enter a wrong code — verification fails, no appointment is created.
      await page.getByTestId('book-otp-code').fill('111111')
      await page.getByTestId('book-otp-verify').click()

      await expect(page.getByTestId('book-error')).toBeVisible()
      await expect(page).not.toHaveURL(/\/booking-confirmation\//)
    } finally {
      await setSmsEnabled(false)
    }
  })

  // The default path: no add-on, so the phone is collected but never verified.
  // The seeded Consultation is priced, so submitting goes straight out to the
  // gateway — reaching it at all is the assertion, because the old flow could
  // not get past the code screen to do so.
  test('with the SMS add-on off there is no code step before checkout', async ({ page }) => {
    expect(await bookToDetails(page)).toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), letterName())
    await fillStable(page.getByTestId('book-phone'), uniquePhone())
    await page.getByTestId('book-submit').click()

    await expect(page).toHaveURL(/\/pay\/mock/, { timeout: 30_000 })
    await expect(page.getByTestId('book-otp-code')).toHaveCount(0)
  })

  test('the week strip pages forward and back with the arrows', async ({ page }) => {
    await openDateStep(page)

    const firstDay = page.locator('[data-testid^="book-day-"]').first()
    const initialKey = await firstDay.getAttribute('data-testid')

    await page.getByTestId('book-week-next').click()
    await expect(firstDay).not.toHaveAttribute('data-testid', initialKey!)

    await page.getByTestId('book-week-prev').click()
    await expect(firstDay).toHaveAttribute('data-testid', initialKey!)
    // The current week starts today, so paging further back must be blocked.
    await expect(page.getByTestId('book-week-prev')).toBeDisabled()
  })
})

test.describe('Public booking — mobile', () => {
  // Below the sm breakpoint the day strip becomes a swipe carousel.
  test.use({ viewport: { width: 390, height: 844 } })

  /** Horizontal pointer drag across the day strip (framer drag listens to
      pointer events, so a mouse drag drives it the same as a touch swipe). */
  async function swipeStrip(page: import('@playwright/test').Page, direction: 'left' | 'right') {
    const strip = page.getByTestId('book-week-strip')
    // Let the carousel slide settle before grabbing it — during the transition
    // AnimatePresence keeps BOTH weeks mounted (the outgoing one slides out),
    // and a drag started mid-entrance is swallowed by the remounting element.
    const group = strip.locator('[role="group"]')
    await expect(group).toHaveCount(1)
    await expect(group).toHaveCSS('transform', 'none')
    const box = (await strip.boundingBox())!
    const y = box.y + box.height / 2
    const fromX = direction === 'left' ? box.x + box.width - 24 : box.x + 24
    const toX = direction === 'left' ? box.x + 24 : box.x + box.width - 24
    await page.mouse.move(fromX, y)
    await page.mouse.down()
    // Several intermediate moves so the gesture registers as a drag, not a click.
    await page.mouse.move((fromX + toX) / 2, y, { steps: 5 })
    await page.mouse.move(toX, y, { steps: 5 })
    await page.mouse.up()
  }

  test('swiping the day strip pages the week', async ({ page }) => {
    await openDateStep(page)

    const firstDay = page.locator('[data-testid^="book-day-"]').first()
    const initialKey = await firstDay.getAttribute('data-testid')

    // Swipe left → next week.
    await swipeStrip(page, 'left')
    await expect(firstDay).not.toHaveAttribute('data-testid', initialKey!)

    // Swipe right → back to the current week.
    await swipeStrip(page, 'right')
    await expect(firstDay).toHaveAttribute('data-testid', initialKey!)

    // At the current week a further back-swipe is a no-op (can't go past today).
    await swipeStrip(page, 'right')
    await expect(firstDay).toHaveAttribute('data-testid', initialKey!)
  })
})

/**
 * On-site (pay-in-person) booking — re-added 2026-08-16 alongside the removal of
 * the ₾5 price floor. A ₾0 service can only be booked this way, so this also
 * covers the free-service path end to end.
 *
 * Creates its own ₾0 service as the seeded owner and deactivates it afterwards,
 * so it never depends on the seed catalogue having a free entry.
 */
test.describe('Public booking — on site', () => {
  const FREE_SVC = 'Free consult (e2e)'
  let serviceId: string | null = null

  test.beforeAll(async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const rows = (await restApi(ctx, 'services', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        org_id: org[0].id, name: FREE_SVC, duration_minutes: 30,
        price: 0, max_per_slot: 1, is_active: true, location_type: 'in_person', sort_order: 99,
      }),
    })) as { id: string }[]
    serviceId = rows[0].id
  })

  test.afterAll(async () => {
    if (!serviceId) return
    const ctx = await signInSeed()
    await restApi(ctx, `services?id=eq.${serviceId}`, {
      method: 'PATCH', body: JSON.stringify({ is_active: false }),
    })
  })

  test('a ₾0 service books on site with no gateway redirect', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}`)
    const svc = page.getByTestId('book-service').filter({ hasText: FREE_SVC })
    await expect(svc.first()).toBeVisible({ timeout: 30_000 })
    await svc.first().click()
    expect(await pickFirstAvailableSlot(page), 'a free slot this week').toBe(true)

    await fillStable(page.getByTestId('book-first-name'), letterName())
    await fillStable(page.getByTestId('book-phone'), uniquePhone())

    // Free ⇒ on site is the ONLY route, so no selector is offered.
    await expect(page.getByTestId('book-pay-online')).toHaveCount(0)
    await expect(page.getByTestId('book-payment-hint')).toBeVisible()

    await page.getByTestId('book-submit').click()
    await passBookingOtp(page)

    // Straight to the confirmation — the gateway is never involved.
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })
    await expect(page.getByTestId('status-approved')).toBeVisible({ timeout: 20_000 })
  })

  test('a priced service offers the choice and defaults to online', async ({ page }) => {
    await page.goto(`/book/${SEED.slug}`)
    const svc = page.getByTestId('book-service').filter({ hasText: 'Consultation' })
    await expect(svc.first()).toBeVisible({ timeout: 30_000 })
    await svc.first().click()
    expect(await pickFirstAvailableSlot(page), 'a free slot this week').toBe(true)

    await expect(page.getByTestId('book-pay-online')).toBeVisible()
    await expect(page.getByTestId('book-pay-on-site')).toBeVisible()
    // Online stays preselected, so the existing online flow is unchanged.
    await expect(page.getByTestId('book-pay-online')).toHaveAttribute('aria-pressed', 'true')
  })

  test('an on-site-only business offers no online route at all', async ({ page }) => {
    // The third policy: a shop that takes cash at the counter. Restore the seed
    // in a finally — later specs expect both methods on offer.
    await setPaymentMethods({ online: false, inPerson: true })
    try {
      await page.goto(`/book/${SEED.slug}`)
      const svc = page.getByTestId('book-service').filter({ hasText: 'Consultation' })
      await expect(svc.first()).toBeVisible({ timeout: 30_000 })
      await svc.first().click()
      expect(await pickFirstAvailableSlot(page), 'a free slot this week').toBe(true)

      // A priced service, yet there is no choice to make and no online option.
      await expect(page.getByTestId('book-pay-on-site')).toHaveCount(0)
      await expect(page.getByTestId('book-pay-online')).toHaveCount(0)
      // ...and the hint promises payment at the appointment, not a gateway.
      await expect(page.getByTestId('book-payment-hint')).toBeVisible()
    } finally {
      await setPaymentMethods({ online: true, inPerson: true })
    }
  })
})
