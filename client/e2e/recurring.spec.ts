import { test, expect } from '@playwright/test'
import { login, signInSeed, restApi, letterName, uniquePhone, SEED } from './helpers'

/**
 * Recurring appointments (Phase 5, migration 095). The generation + cancel run
 * through the real authenticated RPCs (owner context); the add-appointment
 * dialog's "repeat" wiring gets a light UI check.
 */

// A far-future, per-run-unique weekday start at 10:00 business (06:00Z) so the
// weekly occurrences land on free slots (no collision with existing bookings).
function futureStart(): string {
  const d = new Date(Date.now() + (40 + (Date.now() % 200)) * 86_400_000)
  d.setUTCHours(6, 0, 0, 0)
  return d.toISOString()
}

test.describe('Recurring appointments', () => {
  test('create_recurrence_series generates occurrences; cancel_recurrence_series ends them', async () => {
    const ctx = await signInSeed()
    const org = (await restApi(ctx, `organisations?slug=eq.${SEED.slug}&select=id`)) as { id: string }[]
    const svc = (await restApi(ctx, `services?org_id=eq.${org[0].id}&is_active=eq.true&select=id&limit=1`)) as { id: string }[]

    const res = (await restApi(ctx, 'rpc/create_recurrence_series', {
      method: 'POST',
      body: JSON.stringify({
        p_org_id: org[0].id, p_service_id: svc[0].id, p_staff_id: null,
        p_first_name: letterName(), p_last_name: null, p_phone: uniquePhone(),
        p_start_at: futureStart(), p_cadence: 'weekly', p_end_type: 'count',
        p_occurrence_count: 3, p_until_date: null, p_notes: null,
      }),
    })) as { series_id: string; made: number; skipped: number }
    // 3 cadence steps happened; residue from earlier runs may skip a colliding
    // slot, so assert the total (not made === 3) — but at least one must book.
    expect(res.made + res.skipped).toBe(3)
    expect(res.made).toBeGreaterThanOrEqual(1)

    // Every generated occurrence is a real approved appointment on the series.
    const occ = (await restApi(ctx, `appointments?series_id=eq.${res.series_id}&select=status`)) as { status: string }[]
    expect(occ).toHaveLength(res.made)
    expect(occ.every(o => o.status === 'approved')).toBeTruthy()

    // Cancelling the series cancels all its (future) occurrences and ends it.
    const cancelled = (await restApi(ctx, 'rpc/cancel_recurrence_series', {
      method: 'POST', body: JSON.stringify({ p_series_id: res.series_id }),
    })) as number
    expect(cancelled).toBe(res.made)
    const after = (await restApi(ctx, `appointments?series_id=eq.${res.series_id}&select=status`)) as { status: string }[]
    expect(after.every(o => o.status === 'cancelled')).toBeTruthy()
    const series = (await restApi(ctx, `recurrence_series?id=eq.${res.series_id}&select=status`)) as { status: string }[]
    expect(series[0].status).toBe('cancelled')
  })

  test('the add-appointment dialog exposes the repeat / cadence controls', async ({ page }) => {
    await login(page)
    await page.getByTestId('appt-add-btn').click()
    await expect(page.getByTestId('add-appt-dialog')).toBeVisible()
    // Off by default → cadence hidden; toggling repeat reveals the schedule.
    await expect(page.getByTestId('cadence-weekly')).toHaveCount(0)
    await page.getByTestId('add-appt-repeat').click()
    await expect(page.getByTestId('cadence-weekly')).toBeVisible()
    await expect(page.getByTestId('occ-count')).toBeVisible()
  })
})
