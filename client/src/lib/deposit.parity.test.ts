import { describe, expect, it } from 'vitest'
import {
  computeDeposit as clientCompute,
  resolveDeposit as clientResolve,
  depositKind as clientKind,
} from './deposit'
import {
  computeDeposit as denoCompute,
  resolveDeposit as denoResolve,
  depositKind as denoKind,
} from '../../../supabase/functions/_shared/deposit'
import type { DepositConfig } from './deposit'

/**
 * Behavioural sync guard for the two deposit modules. create-payment (Deno)
 * charges what the booking page (client) shows, so the amount must be computed
 * identically — see the KEEP IN SYNC headers in both files. Feeds identical
 * inputs to both and requires identical output.
 */
const cfgs: DepositConfig[] = [
  { type: 'none', value: 10 },
  { type: null, value: 10 },
  { type: 'fixed', value: 20 },
  { type: 'fixed', value: 150 },
  { type: 'percent', value: 25 },
  { type: 'percent', value: 100 },
  { type: 'percent', value: 0 },
]
const prices = [0, 33.33, 80, 100]

describe('client deposit.ts ↔ Deno _shared/deposit.ts parity', () => {
  it('computeDeposit agrees across configs × prices', () => {
    for (const p of prices) {
      for (const c of cfgs) {
        expect(denoCompute(p, c)).toBe(clientCompute(p, c))
      }
    }
  })

  it('resolveDeposit agrees', () => {
    const org: DepositConfig = { type: 'percent', value: 50 }
    for (const s of cfgs) {
      expect(denoResolve(s, org)).toEqual(clientResolve(s, org))
    }
  })

  it('depositKind agrees', () => {
    for (const p of prices) {
      for (const d of [0, p / 2, p]) {
        expect(denoKind(p, d)).toBe(clientKind(p, d))
      }
    }
  })
})
