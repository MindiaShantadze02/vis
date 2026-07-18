import { test, expect, type Page } from '@playwright/test'
import {
  createSeedAppointment, joinWaitlist, uniquePhone, letterName, signInSeed, restApi,
} from './helpers'

/**
 * Cancellation waitlist (Phase 4, migration 093) end to end: customer A books a
 * day, customer B joins the waitlist for it, A's booking is cancelled (freeing
 * the slot → slot_freed_events), the owner's dispatch offers it to B, and B
 * claims the slot via /waitlist/:token (OTP-gated). Offer notify SMS is
 * best-effort (mock); the claim is what we assert.
 */

// A future 10:00-business (06:00Z) slot on a per-run-UNIQUE date, so residue
// waitlist entries from earlier runs (same service) can't match this run's
// freed slot in dispatch's oldest-active-entry pick.
function futureSlot(): { iso: string; date: string } {
  const dayOffset = 10 + (Date.now() % 300) // ~10–310 days out, unique per run
  const d = new Date(Date.now() + dayOffset * 86_400_000)
  d.setUTCHours(6, 0, 0, 0)
  return { iso: d.toISOString(), date: d.toISOString().slice(0, 10) }
}

async function passWaitlistOtp(page: Page) {
  const code = page.getByTestId('waitlist-otp-code')
  await expect(code).toBeVisible({ timeout: 20_000 })
  await code.fill('000000')
  await page.getByTestId('waitlist-otp-submit').click()
}

test.describe('Cancellation waitlist', () => {
  test('a freed slot is offered to a waitlisted customer, who claims it', async ({ page }) => {
    const slot = futureSlot()
    const ctx = await signInSeed()

    // Customer A holds the slot; customer B (fresh phone) waits for that day.
    const apptId = await createSeedAppointment({ firstName: letterName(), phone: uniquePhone(), scheduledAt: slot.iso })
    const bPhone = uniquePhone()
    const entryId = await joinWaitlist({ firstName: letterName(), phone: bPhone, desiredDate: slot.date })
    expect(entryId, 'waitlist entry created').toBeTruthy()

    // A cancels → the AFTER-UPDATE trigger records a freed future slot.
    await restApi(ctx, `appointments?id=eq.${apptId}`, {
      method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }),
    })

    // Owner runs the matcher for this org → an offer is created for B.
    const org = (await restApi(ctx, `organisations?slug=eq.test-appointments-studio&select=id`)) as { id: string }[]
    await restApi(ctx, `rpc/dispatch_waitlist_offers`, {
      method: 'POST', body: JSON.stringify({ p_org_id: org[0].id }),
    })
    const offers = (await restApi(ctx, `waitlist_offers?entry_id=eq.${entryId}&select=claim_token,status`)) as { claim_token: string; status: string }[]
    expect(offers).toHaveLength(1)
    expect(offers[0].status).toBe('pending')

    // B claims via the offer link (fresh phone → no OTP cooldown).
    await page.goto(`/waitlist/${offers[0].claim_token}`)
    await expect(page.getByTestId('waitlist-offer-when')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('waitlist-claim').click()
    await passWaitlistOtp(page)
    await expect(page.getByText('ჯავშანი დადასტურდა')).toBeVisible({ timeout: 20_000 })

    // Server: offer claimed, entry converted, and a booking exists for B.
    const offerAfter = (await restApi(ctx, `waitlist_offers?entry_id=eq.${entryId}&select=status`)) as { status: string }[]
    expect(offerAfter[0].status).toBe('claimed')
    const entryAfter = (await restApi(ctx, `waitlist_entries?id=eq.${entryId}&select=status`)) as { status: string }[]
    expect(entryAfter[0].status).toBe('converted')
    const booked = (await restApi(ctx, `appointments?select=id,customers!inner(phone_number)&customers.phone_number=eq.${bPhone}`)) as unknown[]
    expect(booked).toHaveLength(1)
  })

  test('re-dispatching a slot with a live offer does not double-offer it', async () => {
    // State/concurrency guard: once a freed slot is offered (entry active→offered,
    // one PENDING offer), a second dispatch must not create a duplicate offer or
    // re-offer to another waiter — the pending offer holds the slot (NOT EXISTS
    // pending-offer guard). Pure backend, no browser claim needed.
    const slot = futureSlot()
    const ctx = await signInSeed()

    const apptId = await createSeedAppointment({ firstName: letterName(), phone: uniquePhone(), scheduledAt: slot.iso })
    const entryId = await joinWaitlist({ firstName: letterName(), phone: uniquePhone(), desiredDate: slot.date })

    await restApi(ctx, `appointments?id=eq.${apptId}`, {
      method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }),
    })

    const org = (await restApi(ctx, `organisations?slug=eq.test-appointments-studio&select=id`)) as { id: string }[]
    const dispatch = () => restApi(ctx, `rpc/dispatch_waitlist_offers`, {
      method: 'POST', body: JSON.stringify({ p_org_id: org[0].id }),
    })

    await dispatch()
    await dispatch() // idempotent second run while the first offer is still pending

    const offers = (await restApi(ctx, `waitlist_offers?entry_id=eq.${entryId}&select=status`)) as { status: string }[]
    expect(offers).toHaveLength(1) // exactly one offer, no duplicate
    expect(offers[0].status).toBe('pending')
    const entry = (await restApi(ctx, `waitlist_entries?id=eq.${entryId}&select=status`)) as { status: string }[]
    expect(entry[0].status).toBe('offered') // held, not re-queued
  })
})
