import { CANONICAL_ORIGIN, rpc } from './_shared'

// /sitemap.xml (rewritten here by vercel.json). Static marketing/legal/doc
// routes + one entry per live business booking page (from
// list_public_booking_slugs, migration 087). This is the ONLY crawl path to
// /book/:slug pages — nothing links to them from the app.
//
// No <lastmod>: organisations has no updated_at column, and Google ignores
// unreliable lastmod values anyway. On RPC failure we still emit the static
// routes (uncached) so crawlers get a valid, if partial, document.

export const config = { runtime: 'edge' }

const STATIC_PATHS = ['/', '/docs/widget', '/privacy', '/terms']

export default async function handler(): Promise<Response> {
  let slugs: { slug: string }[] = []
  let ok = true
  try {
    slugs = await rpc<{ slug: string }[]>('list_public_booking_slugs', {})
  } catch {
    ok = false
  }

  const paths = [
    ...STATIC_PATHS,
    ...slugs.map(s => `/book/${encodeURIComponent(s.slug)}`),
  ]

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    paths.map(p => `<url><loc>${CANONICAL_ORIGIN}${p}</loc></url>`).join('') +
    `</urlset>`

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': ok
        ? 'public, s-maxage=3600, stale-while-revalidate=86400'
        : 'no-store',
    },
  })
}
