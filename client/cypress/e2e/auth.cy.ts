/// <reference types="cypress" />
import { buildUser } from '../support/supabase-mock'
import { makeOrg } from '../support/factories'

describe('Authentication', () => {
  describe('guards', () => {
    it('redirects an anonymous visitor from a protected route to /login', () => {
      cy.visit('/dashboard')
      cy.location('pathname').should('eq', '/login')
    })

    it('redirects an already-authenticated user away from /login', () => {
      // Owner with an org → PublicOnlyGuard sends them to the dashboard.
      cy.seedOrg()
      cy.visit('/login')
      cy.location('pathname').should('eq', '/dashboard')
    })

    it('sends an authenticated user with no org and no skip flag to onboarding', () => {
      cy.login()
      cy.mockSupabase({ tables: { org_members: [] } })
      cy.visit('/login')
      cy.location('pathname').should('eq', '/onboarding/business')
    })
  })

  describe('sign in', () => {
    beforeEach(() => {
      cy.visit('/login')
      cy.getByTestId('login-tab-signin').click()
    })

    it('signs in and lands an org member on the dashboard', () => {
      const user = buildUser({ email: 'owner@example.com' })
      cy.mockSupabase({
        authUser: user,
        tables: { org_members: [{ role: 'owner', organisations: makeOrg() }] },
      })

      cy.getByTestId('login-email').type('owner@example.com')
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-submit').click()

      cy.wait('@authToken')
      cy.location('pathname').should('eq', '/dashboard')
    })

    it('shows an error alert for invalid credentials', () => {
      cy.mockSupabase({
        signInError: { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } },
      })

      cy.getByTestId('login-email').type('owner@example.com')
      cy.getByTestId('login-password').type('wrongpass')
      cy.getByTestId('login-submit').click()

      cy.wait('@authToken')
      cy.getByTestId('login-error').should('be.visible').and('contain.text', 'Invalid login credentials')
      cy.location('pathname').should('eq', '/login')
    })

    it('submits on Enter', () => {
      const user = buildUser()
      cy.mockSupabase({
        authUser: user,
        tables: { org_members: [{ role: 'owner', organisations: makeOrg() }] },
      })
      cy.getByTestId('login-email').type('owner@example.com')
      cy.getByTestId('login-password').type('secret123{enter}')
      cy.wait('@authToken')
      cy.location('pathname').should('eq', '/dashboard')
    })

    it('disables the submit button until email and a 6+ char password are entered', () => {
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-email').type('owner@example.com')
      cy.getByTestId('login-password').type('123')
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-password').type('456')
      cy.getByTestId('login-submit').should('not.be.disabled')
    })

    // BVA on the 6-char password minimum: 5 invalid, 6 valid (boundary).
    it('treats a 5-char password as invalid and a 6-char one as valid', () => {
      cy.getByTestId('login-email').type('owner@example.com')
      cy.getByTestId('login-password').type('12345')
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-password').type('6') // 6th char
      cy.getByTestId('login-submit').should('not.be.disabled')
    })

    // EP on the email field: "no @" partition is invalid regardless of password.
    it('keeps submit disabled for an email with no "@", even with a valid password', () => {
      cy.getByTestId('login-email').type('not-an-email')
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-email').clear().type('a@b.co')
      cy.getByTestId('login-submit').should('not.be.disabled')
    })
  })

  describe('sign up', () => {
    beforeEach(() => {
      cy.visit('/login')
      cy.getByTestId('login-tab-signup').click()
    })

    it('keeps submit disabled while the passwords do not match', () => {
      cy.getByTestId('login-email').type('new@example.com')
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-confirm-password').type('secret999')
      cy.getByTestId('login-submit').should('be.disabled')
      // Fix the mismatch → button enables.
      cy.getByTestId('login-confirm-password').clear().type('secret123')
      cy.getByTestId('login-submit').should('not.be.disabled')
    })

    it('keeps submit disabled for a password shorter than 6 chars', () => {
      cy.getByTestId('login-email').type('new@example.com')
      cy.getByTestId('login-password').type('12345')
      cy.getByTestId('login-confirm-password').type('12345')
      cy.getByTestId('login-submit').should('be.disabled')
    })

    it('registers a brand-new user and routes them into onboarding', () => {
      const user = buildUser({ email: 'new@example.com', user_metadata: {} })
      cy.mockSupabase({ authUser: user, tables: { org_members: [] } })

      cy.getByTestId('login-email').type('new@example.com')
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-confirm-password').type('secret123')
      cy.getByTestId('login-submit').click()

      cy.wait('@authSignup')
      cy.location('pathname').should('eq', '/onboarding/business')
    })
  })

  describe('tab switching', () => {
    it('clears entered fields when switching between sign in and sign up', () => {
      cy.visit('/login')
      cy.getByTestId('login-email').type('typed@example.com')
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-tab-signup').click()
      cy.getByTestId('login-email').should('have.value', '')
      cy.getByTestId('login-password').should('have.value', '')
      // The confirm-password field only exists in sign-up mode.
      cy.getByTestId('login-confirm-password').should('exist')
    })
  })
})
