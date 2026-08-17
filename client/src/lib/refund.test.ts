import { describe, expect, it } from 'vitest'
import { refundGate } from './refund'

const STATUSES = ['approved', 'completed', 'no_show', 'cancelled', 'rejected']

describe('refundGate', () => {
  it('offers a refund for money that actually reached the gateway', () => {
    expect(refundGate({ payment_method: 'online', payment_status: 'paid' })).toBe('refundable')
    // Deposits too — the admin path used to refuse these while the customer's
    // own cancel flow refunded them.
    expect(refundGate({ payment_method: 'online', payment_status: 'deposit_paid' })).toBe('refundable')
  })

  it('reports an already-refunded payment instead of offering it again', () => {
    expect(refundGate({ payment_method: 'online', payment_status: 'refunded' })).toBe('refunded')
  })

  it('offers nothing when no money was taken online', () => {
    expect(refundGate({ payment_method: 'online', payment_status: 'unpaid' })).toBe('none')
    expect(refundGate({ payment_method: 'in_person', payment_status: 'paid' })).toBe('none')
    expect(refundGate({ payment_method: 'in_person', payment_status: 'unpaid' })).toBe('none')
    expect(refundGate({})).toBe('none')
    expect(refundGate({ payment_method: null, payment_status: null })).toBe('none')
  })

  it('ignores the appointment status entirely', () => {
    // The point of the feature: a visit that already happened, or one cancelled
    // last week without a refund, is still refundable.
    for (const status of STATUSES) {
      expect(refundGate({ payment_method: 'online', payment_status: 'paid', status } as never))
        .toBe('refundable')
      expect(refundGate({ payment_method: 'online', payment_status: 'refunded', status } as never))
        .toBe('refunded')
    }
  })
})
