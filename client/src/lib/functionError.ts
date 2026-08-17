/**
 * Read the `error` code out of an edge function's response.
 *
 * Our edge functions answer failures with a non-2xx status AND a
 * `{ ok: false, error: '<code>' }` body. supabase-js splits those two apart:
 * on a non-2xx it returns `{ data: null, error: FunctionsHttpError }`, so the
 * body the caller wants to branch on is no longer in `data` — it survives only
 * on `error.context`, the raw `Response`.
 *
 * Pass both halves of the invoke result and get the code back, whichever side
 * it landed on. Returns null for network errors, non-JSON bodies, and successes
 * that carry no error code.
 */
export async function readFunctionError(
  data: unknown,
  err: unknown,
): Promise<string | null> {
  const inData = (data as { error?: unknown } | null)?.error
  if (typeof inData === 'string') return inData

  const ctx = (err as { context?: unknown } | null)?.context
  if (!(ctx instanceof Response)) return null
  try {
    // clone() so a caller that also reads the body still can.
    const body = await ctx.clone().json()
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}
