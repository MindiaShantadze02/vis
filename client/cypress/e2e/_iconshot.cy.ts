// Throwaway spec to screenshot the booking flow for icon review. Delete after.
describe('icon capture', () => {
  it('booking step 1 + 2', () => {
    cy.viewport(1100, 800)
    cy.visit('/book/mindia')
    cy.get('[data-testid=book-service]', { timeout: 25000 }).should('be.visible')
    cy.wait(1000)
    cy.screenshot('icons-step1', { capture: 'viewport', overwrite: true })
    cy.get('[data-testid=book-service]').first().click()
    cy.wait(2000)
    cy.screenshot('icons-step2', { capture: 'viewport', overwrite: true })
  })
})
