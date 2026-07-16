import { test, expect } from '@playwright/test'
import { passBookingOtp, fillStable, bookToDetails, SEED } from './helpers'

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
  test('a guest books an in-person appointment end to end and it auto-approves', async ({ page }) => {
    expect(await bookToDetails(page), 'expected an open day with a free slot this week').toBeTruthy()

    // The quiet "Powered by Vis" growth-loop footer is on every booking page.
    await expect(page.getByTestId('powered-by-vis')).toBeVisible()

    // Step 3 — customer details (seeded org is in-person only, so no pay selector).
    // Name must be letters only (isValidPersonName rejects digits).
    await fillStable(page.getByTestId('book-first-name'), 'Nino')
    await fillStable(page.getByTestId('book-phone'), '599112233')
    await expect(page.getByTestId('book-submit')).toBeEnabled()
    await page.getByTestId('book-submit').click()

    // Phone verification with the master OTP
    await passBookingOtp(page)

    // Confirmation page — the seed org rests with auto-approve on
    // (require_approval = false), so an unpaid guest booking lands already
    // confirmed, not pending. (Approval-required is the column default since 080.)
    await expect(page).toHaveURL(/\/booking-confirmation\//, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /ჯავშანი დადასტურებულია/ })).toBeVisible()
    await expect(page.getByTestId('confirm-book-another')).toBeVisible()
  })

  test('an unknown org slug shows a not-found state', async ({ page }) => {
    await page.goto('/book/this-slug-does-not-exist-xyz')
    // BookingLayout renders an empty/unavailable state rather than the wizard.
    await expect(page.getByTestId('book-service')).toHaveCount(0)
  })

  // --- edge cases ---
  // Step-3 field gating (pairwise/BVA/error-guessing) is data-driven now — see
  // e2e/data/booking-customer.json + e2e/data-driven/booking-customer.spec.ts.

  test('a wrong OTP is rejected and stays on the verification step', async ({ page }) => {
    expect(await bookToDetails(page)).toBeTruthy()
    await fillStable(page.getByTestId('book-first-name'), 'Nino')
    await fillStable(page.getByTestId('book-phone'), '599445566')
    await page.getByTestId('book-submit').click()

    // Enter a wrong code — verification fails, no appointment is created.
    await page.getByTestId('book-otp-code').fill('111111')
    await page.getByTestId('book-otp-verify').click()

    await expect(page.getByTestId('book-error')).toBeVisible()
    await expect(page).not.toHaveURL(/\/booking-confirmation\//)
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
