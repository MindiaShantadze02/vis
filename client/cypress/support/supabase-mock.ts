/// <reference types="cypress" />
/**
 * HTTP-level mock for the Supabase backend.
 *
 * The Grafiki client talks to Supabase entirely over HTTP — GoTrue auth at
 * `/auth/v1/*`, PostgREST tables at `/rest/v1/<table>`, RPCs at
 * `/rest/v1/rpc/<fn>`, and storage at `/storage/v1/*`. By intercepting those
 * endpoints we get a fully deterministic, offline backend driven by a plain
 * `state` object that each spec shapes to describe the world it wants.
 *
 * Usage from a spec:
 *   cy.mockSupabase({ tables: { organisations: [org], org_members: [member] } })
 *   cy.login(user)            // seed an authenticated session
 *   cy.visit('/dashboard')
 */

// ── Types ──────────────────────────────────────────────────────────────────

type Req = Cypress.CyHttpMessages.IncomingHttpRequest

/** A table/rpc entry is either a literal value or a function of the request. */
type Responder<T> = T | ((req: Req) => T)

export interface MockResponse {
  statusCode?: number
  body?: unknown
  headers?: Record<string, string>
}

export interface MockState {
  /** User returned by sign-in / sign-up / GET user. */
  authUser: Record<string, unknown> | null
  /** When set, POST /token?grant_type=password replies with this error. */
  signInError: { status: number; body: unknown } | null
  /** When set, POST /signup replies with this error. */
  signUpError: { status: number; body: unknown } | null
  /** Table name → rows array, or a function returning a full MockResponse. */
  tables: Record<string, Responder<unknown[] | MockResponse>>
  /** RPC name → return value (data), or a function returning a MockResponse/data. */
  rpc: Record<string, Responder<unknown>>
  /**
   * Edge-function name (e.g. 'create-payment') → response. A plain object is
   * returned as the 200 JSON body; a MockResponse ({statusCode,body}) lets a
   * spec simulate a non-2xx error. Unstubbed functions reply 200 {} so an
   * un-set call never escapes to the real backend.
   */
  functions: Record<string, Responder<unknown>>
}

// ── Module state ─────────────────────────────────────────────────────────────

const DEFAULT_STATE: MockState = {
  authUser: null,
  signInError: null,
  signUpError: null,
  tables: {},
  rpc: {},
  functions: {},
}

let state: MockState = structuredClone(DEFAULT_STATE)

export function resetSupabaseState() {
  state = structuredClone(DEFAULT_STATE)
}

export function mergeSupabaseState(partial: Partial<MockState>) {
  state = {
    ...state,
    ...partial,
    tables: { ...state.tables, ...(partial.tables ?? {}) },
    rpc: { ...state.rpc, ...(partial.rpc ?? {}) },
    functions: { ...state.functions, ...(partial.functions ?? {}) },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Project ref from VITE_SUPABASE_URL in client/.env
// (https://dnmecnpugjxkjonqsfxx.supabase.co). supabase-js persists the auth
// session under `sb-<ref>-auth-token`, which is what cy.login seeds.
const SUPABASE_PROJECT_REF = 'dnmecnpugjxkjonqsfxx'

export function projectRef(): string {
  return SUPABASE_PROJECT_REF
}

export function authStorageKey(): string {
  return `sb-${projectRef()}-auth-token`
}

/** A complete GoTrue user object; callers override the fields they care about. */
export function buildUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = (overrides.id as string) ?? '00000000-0000-4000-8000-000000000001'
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.com',
    email_confirmed_at: '2024-01-01T00:00:00Z',
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A non-expired session blob in the exact shape supabase-js persists. */
export function buildSession(user: Record<string, unknown>) {
  const farFuture = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365
  return {
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 31536000,
    expires_at: farFuture,
    refresh_token: 'mock-refresh-token',
    user,
  }
}

function tableFromPath(pathname: string): string | null {
  const m = pathname.match(/\/rest\/v1\/([^/?]+)/)
  return m ? m[1] : null
}

function wantsSingle(req: Req): boolean {
  const accept = String(req.headers['accept'] ?? '')
  return accept.includes('vnd.pgrst.object')
}

function wantsCount(req: Req): boolean {
  const prefer = String(req.headers['prefer'] ?? '')
  return prefer.includes('count=')
}

function isMockResponse(v: unknown): v is MockResponse {
  return !!v && typeof v === 'object' && !Array.isArray(v) &&
    ('statusCode' in (v as object) || 'body' in (v as object) || 'headers' in (v as object))
}

function resolve<T>(entry: Responder<T>, req: Req): T {
  return typeof entry === 'function'
    ? (entry as (r: Req) => T)(req)
    : entry
}

// ── Intercept registration ───────────────────────────────────────────────────

export function installSupabaseIntercepts() {
  // --- Auth: token (sign in + refresh) ---
  cy.intercept({ method: 'POST', pathname: '/auth/v1/token' }, (req) => {
    const grant = req.query.grant_type
    if (grant === 'password') {
      if (state.signInError) {
        req.reply({ statusCode: state.signInError.status, body: state.signInError.body })
        return
      }
    }
    const user = state.authUser ?? buildUser()
    req.reply({ statusCode: 200, body: buildSession(user) })
  }).as('authToken')

  // --- Auth: sign up ---
  cy.intercept({ method: 'POST', pathname: '/auth/v1/signup' }, (req) => {
    if (state.signUpError) {
      req.reply({ statusCode: state.signUpError.status, body: state.signUpError.body })
      return
    }
    const body = (req.body ?? {}) as { email?: string }
    const user = state.authUser ?? buildUser({ email: body.email })
    // Email confirmations are disabled in this project, so sign-up returns a
    // live session and logs the user straight in.
    req.reply({ statusCode: 200, body: { ...buildSession(user), ...user } })
  }).as('authSignup')

  // --- Auth: logout / get user / update user ---
  cy.intercept({ method: 'POST', pathname: '/auth/v1/logout' }, { statusCode: 204, body: {} })
  cy.intercept({ method: 'GET', pathname: '/auth/v1/user' }, (req) => {
    req.reply({ statusCode: 200, body: state.authUser ?? buildUser() })
  })
  // updateUser (e.g. onboarding "skip" sets user_metadata.onboarding_skipped).
  cy.intercept({ method: 'PUT', pathname: '/auth/v1/user' }, (req) => {
    const patch = (req.body ?? {}) as { data?: Record<string, unknown> }
    const base = state.authUser ?? buildUser()
    const updated = {
      ...base,
      user_metadata: { ...(base.user_metadata as object), ...(patch.data ?? {}) },
    }
    state.authUser = updated
    req.reply({ statusCode: 200, body: updated })
  })

  // --- RPC (must be registered after the generic table routes so it wins) ---
  const restHandler = (req: Req) => {
    const pathname = new URL(req.url).pathname

    // RPC: /rest/v1/rpc/<fn>
    const rpcMatch = pathname.match(/\/rest\/v1\/rpc\/([^/?]+)/)
    if (rpcMatch) {
      const fn = rpcMatch[1]
      const entry = state.rpc[fn]
      if (entry === undefined) { req.reply({ statusCode: 200, body: null }); return }
      const resolved = resolve(entry, req)
      if (isMockResponse(resolved)) { req.reply(resolved); return }
      req.reply({ statusCode: 200, body: resolved })
      return
    }

    const table = tableFromPath(pathname)
    if (!table) { req.reply({ statusCode: 200, body: [] }); return }

    // Writes echo their payload back (PostgREST return=representation), which is
    // enough for the UI's optimistic updates.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const body = req.method === 'DELETE' ? [] : (req.body ?? {})
      req.reply({ statusCode: req.method === 'POST' ? 201 : 200, body })
      return
    }

    const entry = state.tables[table]
    const resolved = entry !== undefined ? resolve(entry, req) : []
    if (isMockResponse(resolved)) { req.reply(resolved); return }

    const rows = (resolved as unknown[]) ?? []
    const headers: Record<string, string> = {}
    if (wantsCount(req)) {
      headers['content-range'] = rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0'
    }

    if (req.method === 'HEAD') { req.reply({ statusCode: 200, headers, body: '' }); return }

    if (wantsSingle(req)) {
      if (rows.length === 0) {
        // PGRST116 = "no rows": .maybeSingle() turns this into data:null (no
        // error); .single() surfaces it as an error.
        req.reply({ statusCode: 406, headers, body: { code: 'PGRST116', message: 'no rows' } })
      } else {
        req.reply({ statusCode: 200, headers, body: rows[0] })
      }
      return
    }
    req.reply({ statusCode: 200, headers, body: rows })
  }

  cy.intercept({ method: 'GET', url: /\/rest\/v1\// }, restHandler).as('restGet')
  cy.intercept({ method: 'HEAD', url: /\/rest\/v1\// }, restHandler)
  cy.intercept({ method: 'POST', url: /\/rest\/v1\// }, restHandler).as('restPost')
  cy.intercept({ method: 'PATCH', url: /\/rest\/v1\// }, restHandler).as('restPatch')
  cy.intercept({ method: 'DELETE', url: /\/rest\/v1\// }, restHandler).as('restDelete')

  // --- Edge functions: /functions/v1/<name> (supabase.functions.invoke) ---
  cy.intercept({ method: 'POST', url: /\/functions\/v1\// }, (req) => {
    const m = new URL(req.url).pathname.match(/\/functions\/v1\/([^/?]+)/)
    const fn = m ? m[1] : ''
    const entry = state.functions[fn]
    // Default: succeed with an empty body so an unstubbed call stays offline.
    if (entry === undefined) { req.reply({ statusCode: 200, body: {} }); return }
    const resolved = resolve(entry, req)
    if (isMockResponse(resolved)) { req.reply(resolved); return }
    req.reply({ statusCode: 200, body: resolved })
  }).as('fnInvoke')

  // --- Storage (logo uploads/reads) — never hit the network ---
  cy.intercept({ url: /\/storage\/v1\// }, { statusCode: 200, body: {} })
}
