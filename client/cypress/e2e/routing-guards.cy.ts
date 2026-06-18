/// <reference types="cypress" />

describe('Routing & guards', () => {
  it('AuthGuard: sends an anonymous user from a settings page to /login', () => {
    cy.visit('/dashboard/settings/profile')
    cy.location('pathname').should('eq', '/login')
  })

  it('OrgGuard: bounces an org-less user from the calendar to the dashboard', () => {
    cy.login()
    cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
    cy.visit('/dashboard/calendar')
    cy.location('pathname').should('eq', '/dashboard')
    // Lands on the empty-state overview rather than the calendar.
    cy.contains('ბიზნესი ჯერ არ გაქვთ').should('be.visible')
  })

  it('redirects unknown routes back to the entry point', () => {
    cy.visit('/this/route/does/not/exist')
    // catch-all → "/" → /login for an anonymous visitor.
    cy.location('pathname').should('eq', '/login')
  })

  it('SuperAdminGuard: redirects a non-superadmin away from /superadmin', () => {
    cy.login()
    cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
    cy.visit('/superadmin')
    cy.location('pathname').should('eq', '/dashboard')
  })

  it('the root path redirects to /login', () => {
    cy.visit('/')
    cy.location('pathname').should('eq', '/login')
  })
})
