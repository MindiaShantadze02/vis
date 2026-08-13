import { test, expect } from '@playwright/test'
import {
  login, openApptByName, signInSeed, restApi, type SeedCtx,
  SEED, letterName, uniquePhone, tag,
} from './helpers'

/**
 * Per-appointment online meeting link (migration 082): an online-service
 * appointment is flagged as needing a link; the owner pastes one in the detail
 * dialog and taps "Send to customer", which saves appointments.meeting_link and
 * fires the meeting_link SMS via request_meeting_link_sms → send-sms. Delivery
 * is decoupled from approval, so it works on an already-approved (e.g. paid)
 * appointment — which is what we seed here.
 *
 * Setup/teardown talk straight to PostgREST as the seeded owner (restApi;
 * supabase-js won't construct on Node 20).
 * The appointment can't be hard-deleted (no DELETE policy), so teardown cancels
 * it (drops it from the tier count) and deactivates the throwaway service.
 */
test.describe('Meeting link — per-appointment online link', () => {
  const firstName = letterName()
  const customerId = crypto.randomUUID()
  const appointmentId = crypto.randomUUID()
  let ctx: SeedCtx
  let serviceId: string

  test.beforeAll(async () => {
    ctx = await signInSeed()
    const orgs = await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)
    const orgId = orgs[0].id

    // An online service — no per-service link anymore (constraint relaxed in 082).
    // Owner can see their own services, so return=representation is safe here
    // (we need the generated id).
    const svc = await restApi(ctx, 'services', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        org_id: orgId,
        name: tag('Online consult'),
        duration_minutes: 30,
        // At/above services_price_min — the fixture just needs a valid service.
        price: 5,
        location_type: 'online',
      }),
    })
    serviceId = svc[0].id

    await restApi(ctx, 'customers', {
      method: 'POST',
      body: JSON.stringify({ id: customerId, first_name: firstName, phone_number: uniquePhone() }),
    })

    // Approved (as if auto-approved after payment) and in the near future so the
    // advance-window insert guard passes.
    const when = new Date(Date.now() + 24 * 60 * 60 * 1000)
    when.setHours(12, 0, 0, 0)
    await restApi(ctx, 'appointments', {
      method: 'POST',
      body: JSON.stringify({
        id: appointmentId,
        org_id: orgId,
        service_id: serviceId,
        customer_id: customerId,
        scheduled_at: when.toISOString(),
        duration_minutes: 30,
        status: 'approved',
        payment_method: 'in_person',
        payment_status: 'unpaid',
      }),
    })
  })

  test.afterAll(async () => {
    // Cancel (can't hard-delete) so it leaves the tier count, then retire the
    // throwaway service (its FK from the appt row blocks a real delete).
    await restApi(ctx, `appointments?id=eq.${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    })
    await restApi(ctx, `services?id=eq.${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: false }),
    })
  })

  test('owner attaches a link to an online appointment and sends it', async ({ page }) => {
    await login(page)
    await openApptByName(page, firstName)

    // The online appointment is flagged as needing a link, and the field shows.
    await expect(page.getByTestId('appt-needs-link').first()).toBeVisible()
    const link = page.getByTestId('appt-meeting-link')
    await expect(link).toBeVisible()

    // Invalid link is flagged inline on send (button is never disabled for it).
    await link.fill('not-a-url')
    await page.getByTestId('appt-send-meeting-link').click()
    await expect(link).toHaveAttribute('aria-invalid', 'true')

    // A valid link saves + sends: success toast.
    await link.fill('https://meet.example.com/vis-abc')
    await page.getByTestId('appt-send-meeting-link').click()
    await expect(
      page.getByText(/ბმული გაეგზავნა|link sent|отправлена клиенту/i),
    ).toBeVisible({ timeout: 20_000 })

    // Round-trip: reopen from a fresh load — the saved link prefills (proving
    // search_appointments returns it) and the "needs link" cue is gone.
    await openApptByName(page, firstName)
    await expect(page.getByTestId('appt-meeting-link')).toHaveValue('https://meet.example.com/vis-abc')
    await expect(page.getByTestId('appt-needs-link')).toHaveCount(0)
  })
})
