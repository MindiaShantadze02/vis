import { SUPABASE_URL, SUPABASE_ANON_KEY, CANONICAL_ORIGIN, rpc, esc, htmlHeaders } from './_shared'

// SEO for /book/:slug (rewritten here by vercel.json): serves the SPA shell
// with the default <head> SEO block REPLACED by per-business meta — title,
// description, canonical, OG tags and LocalBusiness JSON-LD — so crawlers and
// social scrapers (which don't run the SPA's JS) see real content. The React
// app itself is untouched: the body/scripts are byte-identical to index.html,
// and BookingLayout still sets the same tags client-side for tab titles.
//
// Failure posture: this function must NEVER break booking. Any Supabase
// hiccup serves the untouched shell (uncached); only a confirmed-missing org
// gets a 404 (fixes the SPA's soft-404 for dead business links).
//
// ?embed=1 iframe traffic takes the same path deliberately: the query string
// is part of the edge-cache key anyway, iframes never display <head>, and one
// code path beats two.

export const config = { runtime: 'edge' }

interface PublicOrg {
  name: string
  description: string | null
  contact_phone: string | null
  address: string | null
  logo_url: string | null
  slug: string
  review_avg: string | number | null
  review_count: number | null
}

/** Swap the <!--seo:start-->…<!--seo:end--> block from index.html; falls back
    to injecting before </head> if the markers ever go missing. */
function replaceSeoBlock(shell: string, head: string): string {
  const re = /<!--seo:start-->[\s\S]*?<!--seo:end-->/
  if (re.test(shell)) return shell.replace(re, head)
  return shell.replace('</head>', `${head}\n</head>`)
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')

  // The shell is a real file in the build output; Vercel resolves filesystem
  // paths BEFORE rewrites, so this fetch cannot recurse into this function.
  const shellRes = await fetch(new URL('/index.html', req.url))
  const shell = await shellRes.text()

  const passthrough = () =>
    new Response(shell, { headers: htmlHeaders('no-store') })

  if (!slug || !SUPABASE_URL || !SUPABASE_ANON_KEY) return passthrough()

  let org: PublicOrg | null
  try {
    const rows = await rpc<PublicOrg[]>('get_public_org', { p_slug: slug })
    org = rows[0] ?? null
  } catch {
    return passthrough()
  }

  if (!org) {
    // Confirmed unknown slug → real 404 + noindex (short cache: a business
    // could register this slug any minute).
    const html = replaceSeoBlock(
      shell,
      `<title>გვერდი ვერ მოიძებნა | Vis</title>\n    <meta name="robots" content="noindex" />`,
    )
    return new Response(html, { status: 404, headers: htmlHeaders('public, s-maxage=60') })
  }

  const canonical = `${CANONICAL_ORIGIN}/book/${encodeURIComponent(org.slug)}`
  const title = `${org.name} — დაჯავშნე ონლაინ | Vis`
  const desc =
    org.description?.trim() ||
    `დაჯავშნე ვიზიტი ${org.name}-ში ონლაინ — აირჩიე სერვისი, სპეციალისტი და დრო.`
  const image = org.logo_url || `${CANONICAL_ORIGIN}/og-image.png`
  const reviewCount = Number(org.review_count ?? 0)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: org.name,
    url: canonical,
    image,
    ...(org.description?.trim() && { description: org.description.trim() }),
    ...(org.address?.trim() && { address: org.address.trim() }),
    ...(org.contact_phone && { telephone: org.contact_phone }),
    ...(reviewCount > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: Number(org.review_avg),
        reviewCount,
      },
    }),
  }

  const head = `<title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="business.business" />
    <meta property="og:site_name" content="Vis" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:locale" content="ka_GE" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${
      // <-escape so org text can never break out of the script tag.
      JSON.stringify(jsonLd).replace(/</g, '\\u003c')
    }</script>`

  // Org meta changes rarely; Vercel purges the edge cache on every deploy.
  return new Response(replaceSeoBlock(shell, head), {
    headers: htmlHeaders('public, s-maxage=3600, stale-while-revalidate=86400'),
  })
}
