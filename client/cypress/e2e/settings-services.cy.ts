/// <reference types="cypress" />
import { makeOrg, makeService } from '../support/factories'

const org = makeOrg()
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

function loadServices(opts: { services?: unknown[]; bookable?: unknown[] } = {}) {
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : (opts.bookable ?? [])),
      services: opts.services ?? [makeService({ name: 'სტრიჟკა' }), makeService({ name: 'წვერი' })],
      service_staff: [],
    },
  })
  cy.visit('/dashboard/settings/services')
}

describe('Settings — services', () => {
  it('lists the existing services', () => {
    loadServices()
    cy.getByTestId('service-row').should('have.length', 2)
    cy.getByTestId('service-row').first().should('contain.text', 'სტრიჟკა')
  })

  it('shows an empty state when there are no services', () => {
    loadServices({ services: [] })
    cy.contains('სერვისები არ არის').should('be.visible')
  })

  it('creates a new service', () => {
    loadServices({ services: [] })
    cy.getByTestId('service-add').click()
    cy.getByTestId('service-name').type('მანიკიური')
    cy.getByTestId('service-duration').clear().type('45')
    cy.getByTestId('service-price').clear().type('25')
    cy.getByTestId('service-save').click()
    cy.wait('@restPost')
    cy.expectToast('შენახულია')
  })

  it('rejects a duration longer than 24h', () => {
    loadServices({ services: [] })
    cy.getByTestId('service-add').click()
    cy.getByTestId('service-name').type('მარათონი')
    cy.getByTestId('service-duration').clear().type('1500')
    cy.getByTestId('service-save').should('be.disabled')
  })

  // BVA on duration: must be > 0 and <= 1440. Check both boundaries.
  it('duration boundaries: 0 and 1441 are rejected, 1 and 1440 are accepted', () => {
    loadServices({ services: [] })
    cy.getByTestId('service-add').click()
    cy.getByTestId('service-name').type('სერვისი')
    cy.getByTestId('service-duration').clear().type('0')
    cy.getByTestId('service-save').should('be.disabled')
    cy.getByTestId('service-duration').clear().type('1')
    cy.getByTestId('service-save').should('not.be.disabled')
    cy.getByTestId('service-duration').clear().type('1440')
    cy.getByTestId('service-save').should('not.be.disabled')
    cy.getByTestId('service-duration').clear().type('1441')
    cy.getByTestId('service-save').should('be.disabled')
  })

  // BVA on per-slot capacity: must be >= 1.
  it('max-per-slot boundary: 0 is rejected, 1 is accepted', () => {
    loadServices({ services: [] })
    cy.getByTestId('service-add').click()
    cy.getByTestId('service-name').type('სერვისი')
    cy.getByTestId('service-max-per-slot').clear().type('0')
    cy.getByTestId('service-save').should('be.disabled')
    cy.getByTestId('service-max-per-slot').clear().type('1')
    cy.getByTestId('service-save').should('not.be.disabled')
  })

  it('toggles a service active flag', () => {
    loadServices()
    cy.getByTestId('service-row').first().find('[data-testid="service-active-toggle"] input').click({ force: true })
    cy.wait('@restPatch')
  })

  it('deletes a service after confirmation', () => {
    loadServices({ services: [makeService({ name: 'სტრიჟკა' })] })
    cy.getByTestId('service-delete').click()
    cy.getByTestId('confirm-dialog-confirm').click()
    cy.wait('@restDelete')
    cy.expectToast('წაშლილია')
  })

  it('shows assignable staff chips in the editor', () => {
    loadServices({ bookable: [{ id: 'mem-1', display_name: 'ნინო', title: 'სტილისტი' }] })
    cy.getByTestId('service-add').click()
    cy.getByTestId('service-staff-chip').should('have.length', 1).and('contain.text', 'ნინო').click()
  })
})
