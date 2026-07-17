import { test, expect, type Page } from '@playwright/test'
import {
  createSeedAppointment, uniquePhone, letterName, signInSeed, restApi,
} from './helpers'

/**
 * Customer self-service reschedule / cancel — /manage/:appointmentId + the
 * manage-appointment edge fn (Phase 3, migration 092), against the live backend.
 * The appointment is created directly (owner insert) so its phone has no recent
 * booking OTP; /manage then requests a fresh code (the '000000' test code is
 * accepted by verify-booking-otp on the hosted project). A cancel/reschedule
 * also writes a slot_freed_events row (consumed by the Phase 4 waitlist).
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

    // Server: the slot moved and a 'rescheduled' freed-slot row was recorded.
    const ctx = await signInSeed()
    const appts = (await restApi(ctx, `appointments?id=eq.${apptId}&select=scheduled_at,status`)) as { scheduled_at: string; status: string }[]
    expect(appts[0].status).toBe('approved')
    const freed = (await restApi(ctx, `slot_freed_events?appointment_id=eq.${apptId}&select=reason`)) as { reason: string }[]
    expect(freed.some(f => f.reason === 'rescheduled')).toBeTruthy()
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
    const freed = (await restApi(ctx, `slot_freed_events?appointment_id=eq.${apptId}&select=reason`)) as { reason: string }[]
    expect(freed.some(f => f.reason === 'cancelled')).toBeTruthy()
  })
})
