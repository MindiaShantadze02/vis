/// <reference types="cypress" />
import { makeOrg } from '../support/factories'

const org = makeOrg({ name: 'ჩემი სალონი', contact_phone: '599 12 34 56' })
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

function loadProfile() {
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
    },
  })
  cy.visit('/dashboard/settings/profile')
}

describe('Settings — profile', () => {
  it('prefills the form from the organisation', () => {
    loadProfile()
    cy.getByTestId('profile-name').should('have.value', 'ჩემი სალონი')
    cy.getByTestId('profile-phone').should('have.value', '599 12 34 56')
  })

  it('saves edits and shows a success toast', () => {
    loadProfile()
    cy.getByTestId('profile-name').clear().type('განახლებული სალონი')
    cy.getByTestId('profile-description').clear().type('ახალი აღწერა')
    cy.getByTestId('profile-save').click()
    cy.wait('@restPatch')
    cy.expectToast('შენახულია')
  })

  it('disables save when the phone is missing or invalid', () => {
    loadProfile()
    cy.getByTestId('profile-phone').clear()
    cy.getByTestId('profile-save').should('be.disabled')
    cy.getByTestId('profile-phone').type('123')
    cy.getByTestId('profile-save').should('be.disabled')
    cy.getByTestId('profile-phone').clear().type('577 65 43 21')
    cy.getByTestId('profile-save').should('not.be.disabled')
  })
})
