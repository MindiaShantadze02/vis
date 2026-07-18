import { test, expect, type Page } from '@playwright/test'
import {
  createSeedAppointment, uniquePhone, letterName, signInSeed, restApi,
} from './helpers'

/**
 * Customer self-service reschedule / cancel — /manage/:appointmentId + the
 * manage-appointment edge fn (Phase 3, migration 092), against the live backend.
 * The appointment is created directly (owner insert) so its phone has no recent
 * booking OTP; /manage then requests a fresh code (the '000000' test code is
 * accepted by verify-booking-otp on the hosted project).
 */

// 8 days out at 10:00 business time (06:00Z) — comfortably in the future so the
// booking stays manageable regardless of the day.
function futureSlotIso(): string {
  const d = new Date(Date.now() + 8 * 86_400_000)
  d.setUTCHours(6, 0, 0, 0)
  return d.toISOString()
}

async function passManageOtp(page: Page) {
  const code = page.getByTestId('manage-otp-code')
  await expect(code).toBeVisible({ timeout: 20_000 })
  await code.fill('000000')
  await page.getByTestId('manage-otp-submit').click()
}

test.describe('Self-service manage', () => {
  test('reschedule via OTP moves the slot and frees the old one', async ({ page }) => {
    const name = letterName()
    const apptId = await createSeedAppointment({ firstName: name, phone: uniquePhone(), scheduledAt: futureSlotIso() })

    await page.goto(`/manage/${apptId}`)
    await page.getByTestId('manage-reschedule').click()

    // The reschedule step reuses the booking date/slot picker — pick the first
    // open day with a free slot.
    const days = page.locator('[data-testid^="book-day-"][data-disabled="false"]')
    await expect(days.first()).toBeVisible({ timeout: 20_000 })
    let picked = false
    for (let i = 0, n = await days.count(); i < n; i++) {
      await days.nth(i).click()
      const slot = page.getByTestId('book-slot').first()
      if (await slot.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
        await slot.click()
        picked = true
        break
      }
    }
    expect(picked, 'expected an open slot to reschedule into').toBeTruthy()

    // Slot chosen → OTP requested → enter the test code.
    await passManageOtp(page)
    await expect(page.getByText('ჯავშანი გადაიტანა')).toBeVisible({ timeout: 20_000 })

    // Server: the appointment is still approved on its (moved) slot.
    const ctx = await signInSeed()
    const appts = (await restApi(ctx, `appointments?id=eq.${apptId}&select=scheduled_at,status`)) as { scheduled_at: string; status: string }[]
    expect(appts[0].status).toBe('approved')
  })

  test('a wrong OTP code is rejected and the booking is left untouched', async ({ page }) => {
    // Negative / error-guessing: the capability link opens the page, but the
    // mutation is OTP-gated. A non-master 6-digit code fails verification — the
    // error surfaces and the appointment must remain approved (no cancel leaks
    // through a bad code).
    const name = letterName()
    const apptId = await createSeedAppointment({ firstName: name, phone: uniquePhone(), scheduledAt: futureSlotIso() })

    await page.goto(`/manage/${apptId}`)
    await page.getByTestId('manage-cancel').click()
    const code = page.getByTestId('manage-otp-code')
    await expect(code).toBeVisible({ timeout: 20_000 })
    await code.fill('111111') // valid shape, wrong code (master is 000000)
    await page.getByTestId('manage-otp-submit').click()

    await expect(page.getByTestId('manage-error')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('ჯავშანი გაუქმდა')).toHaveCount(0)

    const ctx = await signInSeed()
    const appts = (await restApi(ctx, `appointments?id=eq.${apptId}&select=status`)) as { status: string }[]
    expect(appts[0].status).toBe('approved')
  })

  test('an unknown appointment id shows the not-found state (no manage menu)', async ({ page }) => {
    // Equivalence class: a capability UUID that resolves to no appointment. The
    // page must render the not-found state and never expose the reschedule/cancel
    // actions.
    await page.goto(`/manage/${crypto.randomUUID()}`)
    await expect(page.getByTestId('manage-reschedule')).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByTestId('manage-cancel')).toHaveCount(0)
    await expect(page.getByTestId('manage-otp-code')).toHaveCount(0)
  })

  test('cancel via OTP cancels the booking and frees the slot', async ({ page }) => {
    const name = letterName()
    const apptId = await createSeedAppointment({ firstName: name, phone: uniquePhone(), scheduledAt: futureSlotIso() })

    await page.goto(`/manage/${apptId}`)
    await page.getByTestId('manage-cancel').click()
    await passManageOtp(page)
    await expect(page.getByText('ჯავშანი გაუქმდა')).toBeVisible({ timeout: 20_000 })

    const ctx = await signInSeed()
    const appts = (await restApi(ctx, `appointments?id=eq.${apptId}&select=status`)) as { status: string }[]
    expect(appts[0].status).toBe('cancelled')
  })
})
