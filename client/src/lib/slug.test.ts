import { describe, expect, it } from 'vitest'
import { slugify } from './slug'

/**
 * Path/data-flow coverage of the slugify pipeline:
 *   lowercase → transliterate → strip non-ASCII → collapse spaces → collapse
 *   dashes → trim dashes → slice(60) → re-trim.
 * Includes BVA at the 60-char slice boundary and the empty-result path.
 */
describe('slugify', () => {
  it('transliterates Georgian to Latin', () => {
    // ბიზნესი → biznesi
    expect(slugify('ბიზნესი')).toBe('biznesi')
  })

  it('handles mixed Georgian + Latin input', () => {
    expect(slugify('ჩემი Salon 2')).toBe('chemi-salon-2')
  })

  it('lowercases and hyphenates whitespace', () => {
    expect(slugify('My Great Studio')).toBe('my-great-studio')
  })

  it('strips symbols that survive transliteration', () => {
    expect(slugify('Café & Bar!!!')).toBe('caf-bar')
  })

  it('collapses repeated spaces and dashes into a single dash', () => {
    expect(slugify('a   --   b')).toBe('a-b')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('---hello---')).toBe('hello')
  })

  // Data-flow: value that reduces to nothing usable → empty string path.
  it('returns "" when no ASCII-mappable characters remain', () => {
    expect(slugify('日本語')).toBe('')
  })
  it('returns "" for whitespace-only input', () => {
    expect(slugify('   ')).toBe('')
  })

  // BVA at the 60-char slice.
  it('slices to 60 characters', () => {
    const long = 'a'.repeat(80)
    expect(slugify(long)).toHaveLength(60)
  })

  it('re-trims a dash left dangling by the 60-char slice', () => {
    // 59 'a's, then a space that becomes a dash at index 59; slice(0,60) keeps
    // the trailing dash, and the final re-trim must remove it.
    const name = `${'a'.repeat(59)} bcd`
    const result = slugify(name)
    expect(result).toBe('a'.repeat(59))
    expect(result.endsWith('-')).toBe(false)
  })
})
