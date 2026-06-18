/// <reference types="cypress" />
import {
  mergeSupabaseState, authStorageKey, buildUser, buildSession,
  type MockState,
} from './supabase-mock'

// The session JSON to seed into localStorage on the next page load. Set by
// cy.login, consumed by the window:before:load hook in e2e.ts, reset each test.
let pendingSession: string | null = null

export function getPendingSession() {
  return pendingSession
}
export function clearPendingSession() {
  pendingSession = null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Merge a partial backend state into the Supabase mock. */
      mockSupabase(partial: Partial<MockState>): Chainable<void>
      /** Seed an authenticated session (seeded into localStorage before app load). */
      login(userOverrides?: Record<string, unknown>): Chainable<void>
      /** Clear the seeded session — the app loads as an anonymous visitor. */
      logout(): Chainable<void>
      /** `[data-testid="..."]` selector shorthand. */
      getByTestId(testId: string): Chainable<JQuery<HTMLElement>>
      /**
       * Seed an organisation + membership and log in as a member of it.
       * Sets `organisations` and `org_members` (the OrgContext join shape).
       */
      seedOrg(opts?: {
        org?: Record<string, unknown>
        role?: 'owner' | 'admin'
        user?: Record<string, unknown>
      }): Chainable<void>
      /** Assert a toast/snackbar containing the given text is visible. */
      expectToast(text: string): Chainable<void>
    }
  }
}

Cypress.Commands.add('mockSupabase', (partial: Partial<MockState>) => {
  mergeSupabaseState(partial)
})

Cypress.Commands.add('login', (userOverrides: Record<string, unknown> = {}) => {
  const user = buildUser(userOverrides)
  mergeSupabaseState({ authUser: user })
  pendingSession = JSON.stringify(buildSession(user))
})

Cypress.Commands.add('logout', () => {
  pendingSession = null
  mergeSupabaseState({ authUser: null })
})

Cypress.Commands.add('getByTestId', (testId: string) => {
  return cy.get(`[data-testid="${testId}"]`)
})

export const DEFAULT_ORG = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'ტესტ ბიზნესი',
  description: 'ტესტ აღწერა',
  slug: 'test-biz',
  contact_phone: '599 12 34 56',
  logo_url: null,
  subscription_tier: 'pro',
  booking_theme: null,
  payment_config: { inPerson: { enabled: true } },
}

Cypress.Commands.add('seedOrg', (opts = {}) => {
  const org = { ...DEFAULT_ORG, ...(opts.org ?? {}) }
  const role = opts.role ?? 'owner'
  cy.login(opts.user ?? {})
  cy.mockSupabase({
    tables: {
      organisations: [org],
      // OrgContext reads org_members joined with organisations(*) via maybeSingle.
      org_members: [{ role, organisations: org }],
    },
  })
})

Cypress.Commands.add('expectToast', (text: string) => {
  cy.contains('.MuiSnackbar-root, .MuiAlert-message, [data-testid="toast"]', text, {
    timeout: 8000,
  }).should('be.visible')
})

export {}
