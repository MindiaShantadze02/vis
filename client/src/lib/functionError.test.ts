import { describe, expect, it } from 'vitest'
import { readFunctionError } from './functionError'

/** A FunctionsHttpError look-alike: what supabase-js hands back on a non-2xx. */
function httpError(status: number, body: unknown) {
  return { context: new Response(JSON.stringify(body), { status }) }
}

describe('readFunctionError', () => {
  it('reads the code out of a non-2xx response body', async () => {
    const err = httpError(403, { error: 'customer_blocked' })
    await expect(readFunctionError(null, err)).resolves.toBe('customer_blocked')
  })

  it('prefers a code already present in data', async () => {
    await expect(readFunctionError({ ok: false, error: 'slot_taken' }, null))
      .resolves.toBe('slot_taken')
  })

  it('leaves the response body readable for the caller', async () => {
    const err = httpError(409, { error: 'slot_taken' })
    await readFunctionError(null, err)
    // clone() inside the helper means the original is still unconsumed.
    await expect(err.context.json()).resolves.toEqual({ error: 'slot_taken' })
  })

  it('returns null for a network error (no Response to read)', async () => {
    await expect(readFunctionError(null, new Error('Failed to fetch'))).resolves.toBeNull()
  })

  it('returns null for a non-JSON body', async () => {
    const err = { context: new Response('<html>502</html>', { status: 502 }) }
    await expect(readFunctionError(null, err)).resolves.toBeNull()
  })

  it('returns null when nothing failed', async () => {
    await expect(readFunctionError({ checkoutUrl: 'https://pay' }, null)).resolves.toBeNull()
  })

  it('ignores a non-string error field', async () => {
    await expect(readFunctionError({ error: { code: 500 } }, null)).resolves.toBeNull()
  })
})
