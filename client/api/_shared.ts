// Shared helpers for the Vercel Edge Functions (SEO layer). These run OUTSIDE
// the SPA build — tsconfig.app only includes src/, so tsc -b ignores this dir
// and Vercel bundles it with esbuild at deploy time.

// Vercel exposes all project env vars to functions regardless of prefix, so
// the VITE_ build-time vars double as the runtime config; the non-VITE names
// win when set (they're the intended long-term config surface).
export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
export const CANONICAL_ORIGIN =
  process.env.CANONICAL_ORIGIN ?? 'https://vis.ge'

/** POST a PostgREST RPC as anon. Returns parsed JSON or throws. */
export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc ${name} → ${res.status}`)
  return (await res.json()) as T
}

/** HTML-entity escape for interpolating untrusted text into head markup. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // `'` for single-quoted attributes (none today, but cheap insurance), and
    // `$` because the escaped text is later used as a String.replace()
    // replacement, where `$&`/`` $` ``/`$'` are expansion patterns. The call
    // sites use function replacers now; escaping here is the belt to that brace.
    .replace(/'/g, '&#39;')
    .replace(/\$/g, '&#36;')
}

/** Standard HTML response headers with an explicit cache policy. */
export function htmlHeaders(cacheControl: string): HeadersInit {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': cacheControl,
  }
}
