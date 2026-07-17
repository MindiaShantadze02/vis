import { describe, expect, it } from 'vitest'
import { computeDeposit, resolveDeposit, depositKind, type DepositConfig } from './deposit'

/**
 * BVA + ECP for the deposit math (mirrors migration 089 semantics). The charge
 * is clamped to [0, fullPrice]; a service override wins over the org default; a
 * null service type inherits the org default.
 */

const none: DepositConfig = { type: 'none', value: null }
const inherit: DepositConfig = { type: null, value: null }

describe('resolveDeposit (service override vs org default)', () => {
  it('a service with an explicit type wins over the org default', () => {
    expect(resolveDeposit({ type: 'fixed', value: 5 }, { type: 'percent', value: 50 }))
      .toEqual({ type: 'fixed', value: 5 })
  })
  it('an explicit "none" on the service overrides an org deposit', () => {
    expect(resolveDeposit(none, { type: 'percent', value: 50 })).toEqual(none)
  })
  it('a null service type inherits the org default', () => {
    expect(resolveDeposit(inherit, { type: 'percent', value: 50 }))
      .toEqual({ type: 'percent', value: 50 })
  })
})

describe('computeDeposit', () => {
  it.each([
    ['none type → 0', 100, { type: 'none', value: 10 }, 0],
    ['null type → 0', 100, { type: null, value: 10 }, 0],
    ['null value → 0', 100, { type: 'fixed', value: null }, 0],
    ['fixed below price', 100, { type: 'fixed', value: 20 }, 20],
    ['fixed equal to price', 100, { type: 'fixed', value: 100 }, 100],
    ['fixed above price clamps to price', 100, { type: 'fixed', value: 150 }, 100],
    ['percent 25%', 80, { type: 'percent', value: 25 }, 20],
    ['percent 100% = full', 80, { type: 'percent', value: 100 }, 80],
    ['percent rounds to 2dp', 33.33, { type: 'percent', value: 50 }, 16.67],
    ['zero value → 0', 100, { type: 'fixed', value: 0 }, 0],
    ['negative value → 0', 100, { type: 'fixed', value: -5 }, 0],
  ])('%s', (_label, price, cfg, expected) => {
    expect(computeDeposit(price, cfg as DepositConfig)).toBe(expected)
  })
})

describe('depositKind (drives payment_status)', () => {
  it.each([
    ['no deposit', 100, 0, 'none'],
    ['partial', 100, 20, 'partial'],
    ['exactly full is full', 100, 100, 'full'],
    ['just under full is partial', 100, 99.99, 'partial'],
  ])('%s', (_label, price, deposit, expected) => {
    expect(depositKind(price, deposit)).toBe(expected)
  })
})
