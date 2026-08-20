import { test, expect } from '@playwright/test'
import { signInSeed, readSupabaseEnv } from './helpers'

/**
 * Data-protection guarantees that must not regress (Law of Georgia on Personal
 * Data Protection — see docs/COMPLIANCE_GE_DPL.md).
 *
 * These assert the PERMISSION boundaries, which is the half a normal owner's
 * credentials can reach. The data-mutating halves (erasure completeness,
 * retention sweep, appeal flow) are proven by the SQL probes recorded in the
 * migration headers — they need to seed back-dated rows and a superadmin, which
 * an owner token cannot do.
 */

function anonHeaders(anonKey: string) {
  return { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' }
}

test.describe('Data protection — access boundaries', () => {
  test('the processing log is append-only and not readable by a normal owner', async () => {
    const ctx = await signInSeed()
    const auth = {
      apikey: ctx.anonKey,
      authorization: `Bearer ${ctx.accessToken}`,
      'content-type': 'application/json',
    }

    // Art. 27: the log exists to be evidence, so it must not be editable by the
    // very account whose access it records.
    const insert = await fetch(`${ctx.url}/rest/v1/data_access_log`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ action: 'forged' }),
    })
    expect(insert.ok, 'nobody may write the audit log directly').toBeFalsy()

    const del = await fetch(`${ctx.url}/rest/v1/data_access_log?action=eq.forged`, {
      method: 'DELETE', headers: auth,
    })
    expect(del.ok, 'nobody may delete audit history').toBeFalsy()

    // A normal owner is not a superadmin, so the SELECT policy yields nothing.
    const read = await fetch(`${ctx.url}/rest/v1/data_access_log?select=id`, { headers: auth })
    if (read.ok) expect(await read.json()).toEqual([])
  })

  test('the blocklist never exposes a phone number or its hash publicly', async () => {
    const { url, anonKey } = readSupabaseEnv()

    // Anonymous callers must not be able to enumerate who is blocked, nor
    // harvest hashes to test numbers against offline.
    for (const path of [
      'blocked_customers?select=phone',
      'blocked_customers?select=phone_hash',
    ]) {
      const res = await fetch(`${url}/rest/v1/${path}`, { headers: anonHeaders(anonKey) })
      if (res.ok) {
        expect(await res.json(), `${path} must not leak to anon`).toEqual([])
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400)
      }
    }
  })

  test('the phone-hash pepper is never reachable from the client', async () => {
    const ctx = await signInSeed()
    // platform_config holds the pepper that makes the blocklist hash resistant
    // to brute force; a 9-digit number is otherwise trivially reversible.
    for (const token of [ctx.anonKey, ctx.accessToken]) {
      const res = await fetch(`${ctx.url}/rest/v1/platform_config?select=phone_hash_pepper`, {
        headers: { apikey: ctx.anonKey, authorization: `Bearer ${token}` },
      })
      expect(res.ok, 'platform_config must not be readable from the client').toBeFalsy()
    }
  })

  test('an owner cannot grant their own business a billing hold', async () => {
    const ctx = await signInSeed()
    const org = (await (await fetch(
      `${ctx.url}/rest/v1/organisations?slug=eq.test-appointments-studio&select=id`,
      { headers: { apikey: ctx.anonKey, authorization: `Bearer ${ctx.accessToken}` } },
    )).json()) as { id: string }[]

    // billing_review_until is the Art. 19 human-review hold: it unblocks trading
    // while an appeal is considered. Self-granting it would be an unlimited
    // billing bypass, so prevent_billing_self_update must refuse.
    const res = await fetch(`${ctx.url}/rest/v1/organisations?id=eq.${org[0].id}`, {
      method: 'PATCH',
      headers: {
        apikey: ctx.anonKey,
        authorization: `Bearer ${ctx.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ billing_review_until: '2099-01-01T00:00:00Z' }),
    })
    expect(res.ok).toBeFalsy()
    expect(await res.text()).toContain('not_authorized')
  })

  test('appeal and decision RPCs enforce their roles', async () => {
    const ctx = await signInSeed()
    const auth = {
      apikey: ctx.anonKey,
      authorization: `Bearer ${ctx.accessToken}`,
      'content-type': 'application/json',
    }

    // Deciding an appeal is superadmin-only; the seed owner is not one.
    const decide = await fetch(`${ctx.url}/rest/v1/rpc/decide_billing_appeal`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ p_id: '00000000-0000-0000-0000-000000000001', p_accept: true }),
    })
    expect(decide.ok).toBeFalsy()
    expect(await decide.text()).toContain('not_authorized')

    // Raising one for a business you don't own must fail closed — get_user_org_role
    // returns NULL for a foreign org, and an uncoalesced guard would let it through.
    const foreign = await fetch(`${ctx.url}/rest/v1/rpc/request_billing_review`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        p_org_id: '00000000-0000-0000-0000-000000000001',
        p_message: 'this should never be accepted for a foreign org',
      }),
    })
    expect(foreign.ok).toBeFalsy()
    expect(await foreign.text()).toContain('not_authorized')
  })
})
