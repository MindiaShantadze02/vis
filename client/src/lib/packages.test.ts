import { describe, expect, it } from 'vitest'
import {
  remainingSessions, packageRemaining, isPackageExpired, redeemBlock,
  isRedeemable, hasEnoughSessions, activePackagesForService, parseCustomerPackage,
  type CustomerPackage,
} from './packages'

/**
 * BVA + ECP for the session-package helpers. Boundaries mirror the DB rules in
 * migration 20260723120000 (record_package_consumption guard order + the
 * create_recurrence_series remaining ≥ count pre-check).
 */

const NOW = new Date('2026-07-23T12:00:00+04:00')

function pkg(over: Partial<CustomerPackage> = {}): CustomerPackage {
  return {
    id: 'cp1',
    sessionsTotal: 8,
    sessionsUsed: 0,
    expiresAt: null,
    paymentStatus: 'paid',
    packageServiceId: null,
    ...over,
  }
}

describe('remainingSessions', () => {
  // BVA around the total/used difference, incl. the clamp at 0.
  it.each([
    [8, 0, 8],
    [8, 7, 1],
    [8, 8, 0],   // exactly consumed
    [8, 9, 0],   // over-consumed → clamped, never negative
    [1, 0, 1],
    [0, 0, 0],
  ])('total=%i used=%i → %i', (total, used, expected) => {
    expect(remainingSessions(total, used)).toBe(expected)
    expect(packageRemaining({ sessionsTotal: total, sessionsUsed: used })).toBe(expected)
  })
})

describe('isPackageExpired', () => {
  it('null expiry never expires', () => {
    expect(isPackageExpired(null, NOW)).toBe(false)
  })
  it('expiry one second in the past = expired', () => {
    expect(isPackageExpired('2026-07-23T11:59:59+04:00', NOW)).toBe(true)
  })
  it('expiry exactly now = expired (inclusive boundary, matches expires_at <= now())', () => {
    expect(isPackageExpired('2026-07-23T12:00:00+04:00', NOW)).toBe(true)
  })
  it('expiry one second in the future = still valid', () => {
    expect(isPackageExpired('2026-07-23T12:00:01+04:00', NOW)).toBe(false)
  })
  it('malformed date is treated as non-expiring', () => {
    expect(isPackageExpired('not-a-date', NOW)).toBe(false)
  })
})

describe('redeemBlock — guard order mirrors the trigger', () => {
  it('paid, unexpired, any-service, sessions left → redeemable (null)', () => {
    expect(redeemBlock(pkg(), 'svc-A', NOW)).toBeNull()
  })
  it('unpaid blocks first, before any other reason', () => {
    // Also exhausted + wrong service, but not_paid wins (checked first).
    expect(redeemBlock(pkg({ paymentStatus: 'pending', sessionsUsed: 8, packageServiceId: 'svc-B' }), 'svc-A', NOW))
      .toBe('not_paid')
  })
  it('expired blocks before service/exhaustion', () => {
    expect(redeemBlock(pkg({ expiresAt: '2026-07-01T00:00:00+04:00', sessionsUsed: 8 }), 'svc-A', NOW))
      .toBe('expired')
  })
  it('service mismatch blocks before exhaustion', () => {
    expect(redeemBlock(pkg({ packageServiceId: 'svc-B', sessionsUsed: 8 }), 'svc-A', NOW))
      .toBe('service_mismatch')
  })
  it('service-scoped package matches its own service', () => {
    expect(redeemBlock(pkg({ packageServiceId: 'svc-A' }), 'svc-A', NOW)).toBeNull()
  })
  it('exhausted when no sessions remain and everything else passes', () => {
    expect(redeemBlock(pkg({ sessionsUsed: 8 }), 'svc-A', NOW)).toBe('exhausted')
  })
  it('undefined serviceId skips the service check', () => {
    expect(redeemBlock(pkg({ packageServiceId: 'svc-B' }), undefined, NOW)).toBeNull()
  })
})

describe('isRedeemable', () => {
  it('true when redeemBlock is null', () => {
    expect(isRedeemable(pkg(), 'svc-A', NOW)).toBe(true)
  })
  it('false when blocked', () => {
    expect(isRedeemable(pkg({ sessionsUsed: 8 }), 'svc-A', NOW)).toBe(false)
  })
})

describe('hasEnoughSessions — series pre-check (remaining ≥ count)', () => {
  it('count 0 is never valid', () => {
    expect(hasEnoughSessions(pkg(), 0, 'svc-A', NOW)).toBe(false)
  })
  it('remaining exactly equals count → ok (boundary)', () => {
    expect(hasEnoughSessions(pkg({ sessionsTotal: 8, sessionsUsed: 0 }), 8, 'svc-A', NOW)).toBe(true)
  })
  it('remaining one short of count → not enough', () => {
    expect(hasEnoughSessions(pkg({ sessionsTotal: 8, sessionsUsed: 1 }), 8, 'svc-A', NOW)).toBe(false)
  })
  it('remaining one more than count → ok', () => {
    expect(hasEnoughSessions(pkg({ sessionsTotal: 8, sessionsUsed: 0 }), 7, 'svc-A', NOW)).toBe(true)
  })
  it('unpaid fails regardless of count', () => {
    expect(hasEnoughSessions(pkg({ paymentStatus: 'pending' }), 1, 'svc-A', NOW)).toBe(false)
  })
  it('expired fails regardless of count', () => {
    expect(hasEnoughSessions(pkg({ expiresAt: '2026-01-01T00:00:00+04:00' }), 1, 'svc-A', NOW)).toBe(false)
  })
  it('wrong service fails regardless of count', () => {
    expect(hasEnoughSessions(pkg({ packageServiceId: 'svc-B' }), 1, 'svc-A', NOW)).toBe(false)
  })
})

describe('activePackagesForService', () => {
  it('keeps only redeemable packages for the service', () => {
    const list: CustomerPackage[] = [
      pkg({ id: 'ok' }),
      pkg({ id: 'exhausted', sessionsUsed: 8 }),
      pkg({ id: 'unpaid', paymentStatus: 'pending' }),
      pkg({ id: 'wrong-svc', packageServiceId: 'svc-B' }),
      pkg({ id: 'expired', expiresAt: '2026-01-01T00:00:00+04:00' }),
    ]
    expect(activePackagesForService(list, 'svc-A', NOW).map(p => p.id)).toEqual(['ok'])
  })
})

describe('parseCustomerPackage', () => {
  it('coerces PostgREST string numerics and reads embedded service_id', () => {
    const parsed = parseCustomerPackage({
      id: 'cp9',
      sessions_total: '8',
      sessions_used: '3',
      expires_at: '2026-09-01T00:00:00+00:00',
      payment_status: 'paid',
      packages: { service_id: 'svc-A' },
    })
    expect(parsed).toEqual({
      id: 'cp9',
      sessionsTotal: 8,
      sessionsUsed: 3,
      expiresAt: '2026-09-01T00:00:00+00:00',
      paymentStatus: 'paid',
      packageServiceId: 'svc-A',
    })
  })
  it('null packages relation → any-service (null packageServiceId)', () => {
    const parsed = parseCustomerPackage({
      id: 'cp10', sessions_total: 5, sessions_used: 0, payment_status: 'paid', packages: null,
    })
    expect(parsed?.packageServiceId).toBeNull()
    expect(parsed?.expiresAt).toBeNull()
  })
  it('malformed input → null', () => {
    expect(parseCustomerPackage(null)).toBeNull()
    expect(parseCustomerPackage({})).toBeNull()
  })
})
