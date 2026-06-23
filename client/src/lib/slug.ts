// Georgian → Latin transliteration for URL slugs.
//
// The booking slug becomes part of a shareable URL (vis.ge/book/<slug>).
// Keeping raw Georgian letters works technically but browsers percent-encode
// them into unreadable URLs (e.g. %E1%83%91…), so we transliterate to Latin.
// Mapping follows the Georgian National transliteration system (2002).
const KA_TO_LATIN: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't',
  ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh',
  რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q',
  შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh',
  ჯ: 'j', ჰ: 'h',
}

function transliterate(text: string): string {
  let out = ''
  for (const ch of text) out += KA_TO_LATIN[ch] ?? ch
  return out
}

/**
 * Build a URL-safe slug from a business name. Handles Georgian (via
 * transliteration), Latin, and mixed input. Returns '' if nothing
 * usable remains, so callers can apply their own fallback.
 */
export function slugify(text: string): string {
  return transliterate(text.toLowerCase().trim())
    .replace(/[^a-z0-9\s-]/g, '') // drop anything still non-ASCII (e.g. other scripts)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') // trim leading/trailing dashes
    .slice(0, 60)
    .replace(/-+$/g, '') // re-trim in case slice() cut mid-word
}
