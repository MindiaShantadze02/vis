/// <reference types="cypress" />

// Foundation smoke test: verifies the mock layer, the anonymous->/login guard,
// and that a seeded session reaches the authenticated dashboard.
describe('smoke: mock + auth foundation', () => {
  it('redirects an anonymous visitor to /login', () => {
    cy.visit('/dashboard')
    cy.location('pathname').should('eq', '/login')
    cy.getByTestId('login-submit').should('be.visible')
  })

  it('lets a seeded org owner reach the dashboard', () => {
    cy.seedOrg()
    cy.mockSupabase({ rpc: { search_appointments: [] }, tables: { appointments: [] } })
    cy.visit('/dashboard')
    // The booking link only renders for a user with an org.
    cy.contains('თქვენი ბუქინგ ბმული').should('be.visible')
  })
})
