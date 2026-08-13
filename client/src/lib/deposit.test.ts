import { describe, expect, it } from 'vitest'
import { resolveDeposit, computeDeposit, depositFor } from './deposit'

describe('resolveDeposit', () => {
  it('a service override wins over the org default', () => {
    const r = resolveDeposit(
      { deposit_type: 'fixed', deposit_value: 20 },
      { deposit_type: 'percent', deposit_value: 50 },
    )
    expect(r).toEqual({ type: 'fixed', value: 20 })
  })

  it('a NULL service deposit_type inherits the org default', () => {
    const r = resolveDeposit(
      { deposit_type: null, deposit_value: null },
      { deposit_type: 'percent', deposit_value: 30 },
    )
    expect(r).toEqual({ type: 'percent', value: 30 })
  })

  it("an explicit service 'none' overrides the org default (no inherit)", () => {
    const r = resolveDeposit(
      { deposit_type: 'none', deposit_value: null },
      { deposit_type: 'fixed', deposit_value: 20 },
    )
    expect(r).toEqual({ type: 'none', value: 0 })
  })
})

describe('computeDeposit', () => {
  it('none → 0', () => {
    expect(computeDeposit(100, 'none', 0)).toBe(0)
  })

  it('percent of price, rounded to 2dp', () => {
    expect(computeDeposit(100, 'percent', 25)).toBe(25)
    expect(computeDeposit(33.33, 'percent', 10)).toBe(3.33)
  })

  it('fixed amount, passed through', () => {
    expect(computeDeposit(100, 'fixed', 20)).toBe(20)
  })

  it('clamps a fixed deposit that exceeds the price down to the price', () => {
    expect(computeDeposit(50, 'fixed', 80)).toBe(50)
  })

  it('clamps a percent over 100 down to the price', () => {
    expect(computeDeposit(40, 'percent', 150)).toBe(40)
  })

  it('never goes negative', () => {
    expect(computeDeposit(50, 'fixed', -10)).toBe(0)
  })

  // Free services were removed (services_price_min), so a 0 price should never
  // reach here — the clamp is kept as a defensive floor and pinned as one.
  it('clamps to 0 for a price that is somehow zero', () => {
    expect(computeDeposit(0, 'percent', 50)).toBe(0)
    expect(computeDeposit(0, 'fixed', 20)).toBe(0)
  })
})

describe('depositFor', () => {
  it('resolves then computes end-to-end', () => {
    const amount = depositFor(
      { deposit_type: null, deposit_value: null },
      { deposit_type: 'percent', deposit_value: 20 },
      150,
    )
    expect(amount).toBe(30)
  })
})
