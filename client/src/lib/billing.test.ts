import { describe, expect, it } from 'vitest'
import { parseBillingStatus, currentBillTotal, cardExpiryState, isBookingBlocked } from './billing'
import type { BillingState } from './billing'

describe('parseBillingStatus', () => {
  it('parses the get_org_billing_status jsonb, coercing numerics and the card', () => {
    const b = parseBillingStatus({
      billing_status: 'active',
      period_start: '2026-07-01T00:00:00+00:00',
      period_end: '2026-08-01T00:00:00+00:00',
      appointment_count: '34',
      appointment_price: '1',
      running_amount: '34',
      earned: '1250.5',
      rolled_forward: '6',
      card: { last4: '4242', brand: 'visa', expires_at: '2027-05-01' },
    })
    expect(b).toEqual({
      status: 'active',
      periodStart: '2026-07-01T00:00:00+00:00',
      periodEnd: '2026-08-01T00:00:00+00:00',
      appointmentCount: 34,
      appointmentPrice: 1,
      runningAmount: 34,
      earned: 1250.5,
      rolledForward: 6,
      card: { last4: '4242', brand: 'visa', expiresAt: '2027-05-01' },
    })
  })
  it('null card + malformed input', () => {
    expect(parseBillingStatus({ billing_status: 'active', card: null })?.card).toBeNull()
    expect(parseBillingStatus(null)).toBeNull()
    expect(parseBillingStatus({})).toBeNull()
  })
})

describe('currentBillTotal', () => {
  it('sums running + rolled-forward, rounded to 2dp', () => {
    expect(currentBillTotal({ runningAmount: 34, rolledForward: 6 })).toBe(40)
    expect(currentBillTotal({ runningAmount: 0.1, rolledForward: 0.2 })).toBe(0.3)
  })
})

describe('isBookingBlocked — both past_due and suspended block (20260816120000)', () => {
  const b = (status: BillingState) => ({ status })

  it.each([
    ['active → not blocked', b('active'), null, false],
    ['past_due → blocked (this was the reported bug)', b('past_due'), null, true],
    ['suspended → blocked', b('suspended'), null, true],
  ])('%s', (_l, billing, org, expected) => {
    expect(isBookingBlocked(billing, org as BillingState | null)).toBe(expected)
  })

  it('fails CLOSED: no billing snapshot falls back to the org row', () => {
    // get_org_billing_status failed, or this is the render before it resolves.
    expect(isBookingBlocked(null, 'past_due')).toBe(true)
    expect(isBookingBlocked(null, 'suspended')).toBe(true)
    expect(isBookingBlocked(null, 'active')).toBe(false)
  })

  it('prefers the fresh billing snapshot so paying clears the gate', () => {
    // After pay_org_outstanding, refreshBilling() updates `billing` but the org
    // row still carries the stale status until refresh() lands.
    expect(isBookingBlocked(b('active'), 'suspended')).toBe(false)
    // And the converse: a newly-failed charge blocks before the org row catches up.
    expect(isBookingBlocked(b('past_due'), 'active')).toBe(true)
  })

  it('nothing known (signed out / no org) blocks nothing', () => {
    expect(isBookingBlocked(null, null)).toBe(false)
  })
})

describe('cardExpiryState — valid through the END of the expiry month', () => {
  const now = new Date('2026-07-24T12:00:00Z')
  it.each([
    ['null → valid (no card)', null, 'valid'],
    ['blank → valid', '', 'valid'],
    ['malformed → valid', 'not-a-date', 'valid'],
    ['expiry month is this month → still valid (through month end)', '2026-07-01', 'expiring_soon'],
    ['expiry month last month → expired', '2026-06-01', 'expired'],
    ['expiry month next month → valid through Aug 31 (~38 days out)', '2026-08-01', 'valid'],
    ['expiry ~1 year out → valid', '2027-07-01', 'valid'],
  ])('%s', (_label, input, expected) => {
    expect(cardExpiryState(input as string | null, now)).toBe(expected)
  })

  it('boundary: exactly 30 days left = expiring_soon; 31 = valid', () => {
    // End of 2026-08 is 2026-08-31 23:59:59Z. 30 days before ≈ 2026-08-01.
    expect(cardExpiryState('2026-08-01', new Date('2026-08-01T23:59:59Z'))).toBe('expiring_soon')
    expect(cardExpiryState('2026-08-01', new Date('2026-07-31T23:59:58Z'))).toBe('valid')
  })
})
