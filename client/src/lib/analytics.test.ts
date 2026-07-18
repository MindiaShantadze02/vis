import { describe, expect, it } from 'vitest'
import { parseAnalytics, pct } from './analytics'

describe('parseAnalytics', () => {
  it('coerces string numerics and shapes the arrays', () => {
    const a = parseAnalytics({
      revenue: '1250.5', bookings: '40', completed: '28', cancelled: '10', no_show: '2',
      deposits_collected: '5', no_show_rate: '0.067', cancellation_rate: '0.25', repeat_rate: '0.5',
      revenue_by_staff: [{ name: 'Ana', revenue: '800' }, { name: '—', revenue: '450.5' }],
      by_weekday: [22, 17, 5, 9, 11, 1, 1], by_hour: Array(24).fill(0),
    })!
    expect(a.revenue).toBe(1250.5)
    expect(a.completed).toBe(28)
    expect(a.no_show_rate).toBeCloseTo(0.067)
    expect(a.revenue_by_staff).toEqual([{ name: 'Ana', revenue: 800 }, { name: '—', revenue: 450.5 }])
    expect(a.by_weekday).toHaveLength(7)
  })

  it('defaults missing rate denominators to null and arrays to zeros', () => {
    const a = parseAnalytics({ revenue: 0, no_show_rate: null, by_weekday: null })!
    expect(a.no_show_rate).toBeNull()
    expect(a.by_weekday).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(a.by_hour).toHaveLength(24)
  })

  it('returns null for a malformed payload', () => {
    expect(parseAnalytics(null)).toBeNull()
    expect(parseAnalytics(42)).toBeNull()
  })
})

describe('pct', () => {
  it.each([
    [0.067, '7%'],
    [0.25, '25%'],
    [1, '100%'],
    [0, '0%'],
    [null, '—'],
  ])('%s → %s', (r, expected) => {
    expect(pct(r as number | null)).toBe(expected)
  })
})
