import { test, expect } from '@playwright/test'
import { signInSeed, restApi, SEED } from './helpers'

/**
 * Server-side appointment-list filters (migration 20260718090437). The dashboard
 * list is powered by search_appointments; this drives the RPC directly (owner
 * context, RLS applies) to prove each new param actually narrows the result:
 * service, assigned staff, and payment status. Equivalence partitioning — one
 * representative value per new filter — plus the invariant that a filtered
 * result is a subset of the unfiltered one.
 */
type Row = {
  id: string
  service_id: string
  staff_id: string | null
  status: string
  payment_status: string
  total_count: number
}

async function search(ctx: Awaited<ReturnType<typeof signInSeed>>, orgId: string, extra: Record<string, unknown>) {
  return (await restApi(ctx, 'rpc/search_appointments', {
    method: 'POST',
    body: JSON.stringify({ p_org_id: orgId, p_limit: 200, p_offset: 0, ...extra }),
  })) as Row[]
}

test.describe('Appointment list filters — search_appointments', () => {
  test('service, staff, and payment-status filters each narrow the result set', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const orgId = org[0].id

    // Baseline: unfiltered total for the org.
    const all = await search(ctx, orgId, {})
    const allTotal = all[0]?.total_count ?? 0

    // ── Service filter: every returned row is that service, and it's a subset. ──
    const svc = (await restApi(ctx, `services?org_id=eq.${orgId}&is_active=eq.true&select=id&limit=1`)) as { id: string }[]
    const byService = await search(ctx, orgId, { p_service_id: svc[0].id })
    expect(byService.every(r => r.service_id === svc[0].id)).toBeTruthy()
    expect(byService[0]?.total_count ?? 0).toBeLessThanOrEqual(allTotal)

    // ── Payment-status filter: representative 'paid' partition. ──
    const byPaid = await search(ctx, orgId, { p_payment_status: 'paid' })
    expect(byPaid.every(r => r.payment_status === 'paid')).toBeTruthy()
    expect(byPaid[0]?.total_count ?? 0).toBeLessThanOrEqual(allTotal)

    // ── Staff filter (only meaningful if the org has a bookable member). ──
    const staff = (await restApi(ctx, `org_members?org_id=eq.${orgId}&is_bookable=eq.true&select=id&limit=1`)) as { id: string }[]
    if (staff.length) {
      const byStaff = await search(ctx, orgId, { p_staff_id: staff[0].id })
      expect(byStaff.every(r => r.staff_id === staff[0].id)).toBeTruthy()
    }

    // ── Combined filters still apply as an AND (subset of each single filter). ──
    const combined = await search(ctx, orgId, { p_service_id: svc[0].id, p_payment_status: 'paid' })
    expect(combined.every(r => r.service_id === svc[0].id && r.payment_status === 'paid')).toBeTruthy()
  })
})
