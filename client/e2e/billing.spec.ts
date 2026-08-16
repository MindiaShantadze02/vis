import { test, expect } from '@playwright/test'
import {
  login, signInSeed, restApi, readSupabaseEnv, serviceRoleKey, setSeedBillingStatus,
  uniquePhone, SEED,
} from './helpers'

/**
 * Post-paid billing core (BILLING_PLAN T1.1). Verifies the owner-facing
 * guarantees of the new schema against the live backend: an owner can READ their
 * own invoices but can neither self-modify billing_status (prevent_billing_self_update)
 * nor write the billing ledger (no INSERT policy). The (org_id, period_start)
 * uniqueness and the service-role path are covered by the migration's DB smoke
 * test; here we assert what a client can actually reach.
 */

test.describe('Billing core — guard + RLS', () => {
  test('owner cannot self-modify billing_status, can read invoices, cannot write the ledger', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id,billing_status`)) as
      { id: string; billing_status: string }[]
    const orgId = org[0].id
    const before = org[0].billing_status

    // Guard: a plain PATCH of billing_status is rejected by prevent_billing_self_update.
    const patch = await fetch(`${ctx.url}/rest/v1/organisations?id=eq.${orgId}`, {
      method: 'PATCH',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ billing_status: 'suspended' }),
    })
    expect(patch.ok).toBeFalsy()
    expect(await patch.text()).toContain('not_authorized')

    // …and the value is unchanged.
    const after = (await restApi(ctx, `organisations?id=eq.${orgId}&select=billing_status`)) as
      { billing_status: string }[]
    expect(after[0].billing_status).toBe(before)

    // Owner CAN read their own billing tables (SELECT policy). Empty is fine.
    const periods = await restApi(ctx, `billing_periods?org_id=eq.${orgId}&select=id`)
    expect(Array.isArray(periods)).toBeTruthy()

    // Owner CANNOT write the ledger — no INSERT policy, so RLS/grant denies it.
    const ins = await fetch(`${ctx.url}/rest/v1/billing_periods`, {
      method: 'POST',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ org_id: orgId, period_start: '2026-06-01', period_end: '2026-07-01' }),
    })
    expect(ins.ok).toBeFalsy()
  })

  /**
   * The billing exemption (superadmin-owned orgs are never invoiced or blocked)
   * must not be self-grantable — otherwise any business simply stops paying.
   *
   * Both tenant-writable routes to a *derived* exemption are covered here too,
   * because they are exactly why the flag is an explicit guarded column rather
   * than "is this org's owner a superadmin?":
   *   * `organisations_update` covers the whole row, including `owner_id`
   *   * `org_members_insert` accepts any `user_id` with `role='owner'`
   * and the superadmin uuid is public (VITE_SUPERADMIN_USER_ID ships in the
   * browser bundle). None of it may move the needle.
   */
  test('owner cannot grant themselves the billing exemption', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id,billing_exempt`)) as
      { id: string; billing_exempt: boolean }[]
    const orgId = org[0].id
    expect(org[0].billing_exempt, 'seed org starts non-exempt').toBe(false)

    const patch = (body: Record<string, unknown>) =>
      fetch(`${ctx.url}/rest/v1/organisations?id=eq.${orgId}`, {
        method: 'PATCH',
        headers: {
          apikey: ctx.anonKey,
          authorization: `Bearer ${ctx.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })

    // 1. Direct self-grant → rejected by prevent_billing_self_update.
    const direct = await patch({ billing_exempt: true })
    expect(direct.ok).toBeFalsy()
    expect(await direct.text()).toContain('not_authorized')

    // 2. Smuggled alongside an edit the owner IS allowed to make.
    const smuggled = await patch({ description: 'exemption smuggling test', billing_exempt: true })
    expect(smuggled.ok).toBeFalsy()

    // 3. Creating a fresh org pre-set as exempt → the INSERT trigger overwrites it.
    const created = await fetch(`${ctx.url}/rest/v1/organisations`, {
      method: 'POST',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        name: 'Exemption probe', slug: `exempt-probe-${Date.now()}`, billing_exempt: true,
      }),
    })
    if (created.ok) {
      const rows = (await created.json()) as { id: string; billing_exempt: boolean }[]
      expect(rows[0].billing_exempt, 'insert trigger pins it to false').toBe(false)
      await fetch(`${ctx.url}/rest/v1/organisations?id=eq.${rows[0].id}`, {
        method: 'DELETE',
        headers: { apikey: ctx.anonKey, authorization: `Bearer ${ctx.accessToken}` },
      })
    }

    // The seed org is untouched throughout.
    const after = (await restApi(ctx, `organisations?id=eq.${orgId}&select=billing_exempt`)) as
      { billing_exempt: boolean }[]
    expect(after[0].billing_exempt).toBe(false)
  })

  test('add a card from Settings → Billing: token stored, nothing charged', async ({ page }) => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const orgId = org[0].id
    // Baseline: adding a card must create no billing period (never charges).
    const periodsBefore = (await restApi(ctx, `billing_periods?org_id=eq.${orgId}&select=id`)) as unknown[]

    await login(page)
    await page.goto('/dashboard/settings/billing')
    await page.getByTestId('billing-add-card').click()
    await expect(page.getByTestId('card-form')).toBeVisible()
    // The "nothing is charged now" disclaimer is on the form (T2.2).
    await expect(page.getByTestId('card-disclaimer')).toBeVisible()

    await page.getByTestId('card-number').fill('4242 4242 4242 4242')
    const yy = String(new Date().getFullYear() + 2).slice(-2)
    await page.getByTestId('card-expiry').fill(`09/${yy}`)
    await page.getByTestId('card-save').click()

    // The card shows with its last 4.
    await expect(page.getByTestId('billing-card')).toContainText('4242', { timeout: 15_000 })

    // Token is stored (a default, active card exists). Owners can't read the
    // token column, but they can see it's there via the metadata.
    const cards = (await restApi(
      ctx,
      `org_payment_methods?org_id=eq.${orgId}&is_default=eq.true&status=eq.active&select=last4,brand`,
    )) as { last4: string; brand: string }[]
    expect(cards.length).toBe(1)
    expect(cards[0].last4).toBe('4242')

    // No charge: adding a card created no billing period.
    const periodsAfter = (await restApi(ctx, `billing_periods?org_id=eq.${orgId}&select=id`)) as unknown[]
    expect(periodsAfter.length).toBe(periodsBefore.length)
  })

  // Unpaid → blocked → recovered. Since 20260816120000 BOTH 'past_due' and
  // 'suspended' block bookings; 'past_due' is the state that regressed (it used
  // to keep taking bookings for the whole ~11-day dunning window).
  //
  // Seeding it needs the service role: owners are rejected by
  // prevent_billing_self_update, which the first test above asserts. Without
  // SUPABASE_SERVICE_ROLE_KEY in client/.env this skips rather than fails — and
  // that gap is exactly why the booking leak went unnoticed, so prefer running
  // it. The status is ALWAYS restored in `finally`; leaving the seed org blocked
  // would cascade through the rest of the suite.
  test('past_due org: booking page unavailable, blocking modal shown, cannot be dismissed', async ({ page }) => {
    test.skip(!serviceRoleKey(), 'needs SUPABASE_SERVICE_ROLE_KEY in client/.env to seed billing_status')

    await setSeedBillingStatus('past_due')
    try {
      // Customers see the neutral unavailable state — never "they haven't paid".
      await page.goto(`/book/${SEED.slug}`)
      await expect(page.getByTestId('booking-unavailable').or(page.getByText(/unavailable|მიუწვდ|недоступ/i)))
        .toBeVisible({ timeout: 20_000 })

      // Dashboard still loads — data isn't hidden over billing — but the owner
      // gets the blocking modal, and Escape must not dismiss it.
      await login(page)
      await expect(page).toHaveURL(/\/dashboard/)
      await expect(page.getByTestId('billing-blocked-dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('billing-blocked-dialog')).toBeVisible()

      // Billing stays reachable so the owner can act: the modal steps aside there.
      await page.goto('/dashboard/settings/billing')
      await expect(page.getByTestId('billing-blocked-dialog')).toHaveCount(0)
      await expect(page.getByTestId('billing-dunning')).toBeVisible()
    } finally {
      await setSeedBillingStatus('active')
    }

    // Recovery: with the org active again, both sides come back.
    await page.goto('/dashboard')
    await expect(page.getByTestId('billing-blocked-dialog')).toHaveCount(0)
    await page.goto(`/book/${SEED.slug}`)
    await expect(page.getByTestId('book-service').first()).toBeVisible({ timeout: 20_000 })
  })

  // The server is the real enforcement — the modal is only an explanation. Drive
  // the write paths directly, with no browser involved, so a UI regression can
  // never mask a missing DB gate.
  test('past_due org: the server refuses bookings, not just the UI', async () => {
    test.skip(!serviceRoleKey(), 'needs SUPABASE_SERVICE_ROLE_KEY in client/.env to seed billing_status')

    const ctx = await signInSeed()
    const { url, anonKey } = readSupabaseEnv()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const orgId = org[0].id

    const canAccept = async () => {
      const res = await fetch(`${url}/rest/v1/rpc/org_can_accept_appointment`, {
        method: 'POST',
        headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ p_org_id: orgId }),
      })
      return res.json() as Promise<boolean>
    }

    expect(await canAccept(), 'seed org starts bookable').toBe(true)

    await setSeedBillingStatus('past_due')
    try {
      // The regression itself: past_due used to answer true here.
      expect(await canAccept(), 'past_due must block — this is the reported bug').toBe(false)

      // And the checkout path refuses before taking any money.
      const svc = (await restApi(ctx, `services?org_id=eq.${orgId}&is_active=eq.true&select=id&limit=1`)) as
        { id: string }[]
      const pay = await fetch(`${url}/functions/v1/create-payment`, {
        method: 'POST',
        headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          purpose: 'appointment',
          org_id: orgId,
          service_id: svc[0].id,
          scheduled_at: new Date(Date.now() + 8 * 86_400_000).toISOString(),
          first_name: 'Blocked',
          phone: uniquePhone(),
          slug: SEED.slug,
        }),
      })
      expect(pay.status, 'create-payment must refuse a blocked org').toBe(422)
      expect((await pay.json()).error).toBe('limit_reached')
    } finally {
      await setSeedBillingStatus('active')
    }

    expect(await canAccept(), 'restored to bookable').toBe(true)
  })

  test('suspended org blocks too', async () => {
    test.skip(!serviceRoleKey(), 'needs SUPABASE_SERVICE_ROLE_KEY in client/.env to seed billing_status')

    const ctx = await signInSeed()
    const { url, anonKey } = readSupabaseEnv()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]

    await setSeedBillingStatus('suspended')
    try {
      const res = await fetch(`${url}/rest/v1/rpc/org_can_accept_appointment`, {
        method: 'POST',
        headers: { apikey: anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ p_org_id: org[0].id }),
      })
      expect(await res.json()).toBe(false)
    } finally {
      await setSeedBillingStatus('active')
    }
  })
})
