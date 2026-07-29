import { describe, it, expect, beforeEach } from 'vitest'
import { captureAcquisitionSource, getAcquisitionSource } from './acquisition'

function mockStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage()
})

describe('captureAcquisitionSource', () => {
  it('captures ?src', () => {
    captureAcquisitionSource('?src=fb-group')
    expect(getAcquisitionSource()).toBe('fb-group')
  })

  it('precedence: src > utm_source > ref', () => {
    captureAcquisitionSource('?utm_source=google&ref=badge&src=fb')
    expect(getAcquisitionSource()).toBe('fb')
  })

  it('falls back to utm_source, then ref', () => {
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage()
    captureAcquisitionSource('?utm_source=google&ref=badge')
    expect(getAcquisitionSource()).toBe('google')

    ;(globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage()
    captureAcquisitionSource('?ref=badge')
    expect(getAcquisitionSource()).toBe('badge')
  })

  it('first-touch: a later source never overwrites the first', () => {
    captureAcquisitionSource('?src=first')
    captureAcquisitionSource('?src=second')
    expect(getAcquisitionSource()).toBe('first')
  })

  it('no source param → null', () => {
    captureAcquisitionSource('?foo=bar')
    expect(getAcquisitionSource()).toBeNull()
  })

  it('trims and caps length at 60', () => {
    captureAcquisitionSource('?src=' + 'x'.repeat(100))
    expect(getAcquisitionSource()).toHaveLength(60)
  })
})
