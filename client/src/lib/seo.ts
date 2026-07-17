import { useEffect } from 'react'

// Canonical site origin for absolute URLs (canonical links, and mirrored by
// the Vercel edge functions in api/). One env var swaps the domain everywhere
// except the two static files (index.html, robots.txt).
export const CANONICAL_ORIGIN =
  (import.meta.env.VITE_CANONICAL_ORIGIN as string | undefined) ?? 'https://vis.ge'

interface DocumentMeta {
  title: string
  description?: string
  /** Path for <link rel="canonical"> (e.g. '/', '/book/acme'). Omit on
      private/transactional pages — the tag is then REMOVED, so a canonical
      from a previously visited route can't leak across SPA navigations. */
  canonicalPath?: string
  /** Client-side robots noindex (NotFoundPage, unknown-org booking page).
      Transactional routes get the reliable X-Robots-Tag header via
      vercel.json; this is belt-and-suspenders for SPA-internal states. */
  noindex?: boolean
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (content == null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (href == null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/**
 * Per-route document head: title, meta description, canonical, robots.
 * No dependency (helmet et al.) — a handful of head tags doesn't warrant one.
 *
 * Pages compute `title` with t(), so a language switch re-renders the caller
 * and this effect re-runs with the translated values; <html lang> itself is
 * synced by the languageChanged listener in lib/i18n.ts.
 *
 * For /book/:slug the SAME tags are also server-injected by api/book-meta.ts
 * (crawlers/social bots don't run this hook); this client copy keeps the tab
 * title and SPA navigations correct.
 */
export function useDocumentMeta({ title, description, canonicalPath, noindex }: DocumentMeta) {
  useEffect(() => {
    document.title = title
    upsertMeta('name', 'description', description ?? null)
    upsertCanonical(canonicalPath != null ? `${CANONICAL_ORIGIN}${canonicalPath}` : null)
    upsertMeta('name', 'robots', noindex ? 'noindex' : null)
  }, [title, description, canonicalPath, noindex])
}
