import { describe, expect, it } from 'vitest'
import { storageImage, storageSrcSet } from './storageImage'

/**
 * The rules these encode were learned the hard way: asking Supabase's renderer
 * for a `width` alone does NOT preserve the aspect ratio — an 800×800 logo came
 * back 112×800 and rendered visibly squashed on the booking page. Proportions
 * survive only when a height and an explicit resize mode ride along, so that is
 * what these tests pin down.
 */

const OBJECT = 'https://x.supabase.co/storage/v1/object/public/service-images/org/svc/a.jpg'
const VERSIONED = 'https://x.supabase.co/storage/v1/object/public/logos/org/logo.webp?v=1786914195480'

describe('storageImage', () => {
  it('points at the render endpoint', () => {
    expect(storageImage(OBJECT, 1040)).toContain('/storage/v1/render/image/public/')
    expect(storageImage(OBJECT, 1040)).not.toContain('/storage/v1/object/public/')
  })

  it('always sends height + resize so the aspect ratio is preserved', () => {
    const params = new URLSearchParams(storageImage(OBJECT, 1040).split('?')[1])
    expect(params.get('width')).toBe('1040')
    // Without these two the renderer stretches the image to the source height.
    expect(params.get('resize')).toBe('contain')
    expect(Number(params.get('height'))).toBeGreaterThan(1040)
  })

  it('rounds a fractional width (DPR maths can produce one)', () => {
    expect(new URLSearchParams(storageImage(OBJECT, 416.6).split('?')[1]).get('width')).toBe('417')
  })

  it('keeps the cache-buster, or a replaced logo keeps serving the old render', () => {
    expect(new URLSearchParams(storageImage(VERSIONED, 112).split('?')[1]).get('v')).toBe('1786914195480')
  })

  it('passes through anything it cannot transform', () => {
    for (const url of ['blob:http://localhost/abc', 'data:image/png;base64,iVBOR', 'https://cdn.example.com/a.jpg']) {
      expect(storageImage(url, 500)).toBe(url)
    }
  })

  it('ignores a nonsense width rather than emitting a broken URL', () => {
    expect(storageImage(OBJECT, 0)).toBe(OBJECT)
    expect(storageImage(OBJECT, Number.NaN)).toBe(OBJECT)
  })
})

describe('storageSrcSet', () => {
  it('offers the slot width at 1x and double it at 2x', () => {
    const set = storageSrcSet(OBJECT, 520)!
    const [one, two] = set.split(', ')
    expect(one).toContain('width=520')
    expect(one.endsWith(' 1x')).toBe(true)
    expect(two).toContain('width=1040')
    expect(two.endsWith(' 2x')).toBe(true)
  })

  it('is undefined for untransformable sources, so the caller just uses src', () => {
    expect(storageSrcSet('blob:http://localhost/abc', 520)).toBeUndefined()
  })
})
