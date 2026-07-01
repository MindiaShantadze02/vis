/// <reference types="cypress" />
import { buildUser } from '../support/supabase-mock'
import { makeOrg } from '../support/factories'

// Login is phone + password (Georgian national number, 9 digits). The mock
// auth endpoints ignore the credential value, so any valid phone works.
const PHONE = '599123456'

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
    })

    it('signs in and lands an org member on the dashboard', () => {
      const user = buildUser({ phone: '995599123456' })
      cy.mockSupabase({
        authUser: user,
        tables: { org_members: [{ role: 'owner', organisations: makeOrg() }] },
      })

      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-submit').click()

      cy.wait('@authToken')
      cy.location('pathname').should('eq', '/dashboard')
    })

    it('shows an error alert for invalid credentials', () => {
      cy.mockSupabase({
        signInError: { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } },
      })

      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('wrongpass')
      cy.getByTestId('login-submit').click()

      cy.wait('@authToken')
      // The raw English error is mapped to a localized message before display.
      cy.getByTestId('login-error').should('be.visible').and('contain.text', 'არასწორი')
      cy.location('pathname').should('eq', '/login')
    })

    it('submits on Enter', () => {
      const user = buildUser({ phone: '995599123456' })
      cy.mockSupabase({
        authUser: user,
        tables: { org_members: [{ role: 'owner', organisations: makeOrg() }] },
      })
      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('secret123{enter}')
      cy.wait('@authToken')
      cy.location('pathname').should('eq', '/dashboard')
    })

    it('disables the submit button until a phone and a 6+ char password are entered', () => {
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('123')
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-password').type('456')
      cy.getByTestId('login-submit').should('not.be.disabled')
    })

    // BVA on the 6-char password minimum: 5 invalid, 6 valid (boundary).
    it('treats a 5-char password as invalid and a 6-char one as valid', () => {
      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('12345')
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-password').type('6') // 6th char
      cy.getByTestId('login-submit').should('not.be.disabled')
    })

    // EP on the phone field: a too-short number is invalid regardless of password.
    it('keeps submit disabled for an invalid phone, even with a valid password', () => {
      cy.getByTestId('login-phone').type('12345')
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-submit').should('be.disabled')
      cy.getByTestId('login-phone').clear().type(PHONE)
      cy.getByTestId('login-submit').should('not.be.disabled')
    })
  })

  // Registration is now vertical-specific: each ad links to /register/:vertical.
  describe('sign up', () => {
    beforeEach(() => {
      cy.visit('/register/appointments')
    })

    it('keeps submit disabled while the passwords do not match', () => {
      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-confirm-password').type('secret999')
      cy.getByTestId('login-submit').should('be.disabled')
      // Fix the mismatch → button enables.
      cy.getByTestId('login-confirm-password').clear().type('secret123')
      cy.getByTestId('login-submit').should('not.be.disabled')
    })

    it('keeps submit disabled for a password shorter than 6 chars', () => {
      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('12345')
      cy.getByTestId('login-confirm-password').type('12345')
      cy.getByTestId('login-submit').should('be.disabled')
    })

    it('registers a brand-new user and routes them into onboarding', () => {
      const user = buildUser({ phone: '995599123456', user_metadata: {} })
      cy.mockSupabase({ authUser: user, tables: { org_members: [] } })

      cy.getByTestId('login-phone').type(PHONE)
      cy.getByTestId('login-password').type('secret123')
      cy.getByTestId('login-confirm-password').type('secret123')
      cy.getByTestId('login-submit').click()

      cy.wait('@authSignup')
      cy.location('pathname').should('eq', '/onboarding/business')
    })
  })

  describe('navigation between login and register', () => {
    it('links from /login to the registration picker', () => {
      cy.visit('/login')
      // No confirm-password field on the sign-in-only login page.
      cy.getByTestId('login-confirm-password').should('not.exist')
      cy.getByTestId('login-to-register').click()
      cy.location('pathname').should('eq', '/register')
      // The picker deep-links to each vertical's signup.
      cy.getByTestId('register-pick-hotel').click()
      cy.location('pathname').should('eq', '/register/hotel')
      cy.getByTestId('login-confirm-password').should('exist')
    })
  })
})
