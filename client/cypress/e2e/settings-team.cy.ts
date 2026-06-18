/// <reference types="cypress" />
import { makeOrg } from '../support/factories'

const org = makeOrg()
const SELF_ID = '00000000-0000-4000-8000-000000000001' // cy.login default user id
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

const members = [
  { id: 'm-owner', user_id: SELF_ID, role: 'owner', joined_at: '2024-01-01', display_name: 'მფლობელი', title: null, is_bookable: false, sort_order: 0 },
  { id: 'm-admin', user_id: 'other-user', role: 'admin', joined_at: '2024-02-01', display_name: 'ადმინი ანა', title: 'მენეჯერი', is_bookable: true, sort_order: 1 },
]

function loadTeam(invitations: unknown[] = []) {
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : members),
      invitations,
    },
  })
  cy.visit('/dashboard/settings/team')
}

describe('Settings — team', () => {
  it('lists members and marks roles', () => {
    loadTeam()
    cy.getByTestId('member-row').should('have.length', 2)
    cy.contains('მფლობელი').should('be.visible')
    cy.contains('ადმინი ანა').should('be.visible')
  })

  it('only allows deleting non-owner, non-self members', () => {
    loadTeam()
    // Owner + self are protected, so exactly one delete control is shown.
    cy.getByTestId('member-delete').should('have.length', 1)
  })

  it('edits a member', () => {
    loadTeam()
    cy.getByTestId('member-edit').first().click()
    cy.getByTestId('member-name').clear().type('ახალი სახელი')
    cy.get('[data-testid="member-bookable"] input').click({ force: true })
    cy.getByTestId('member-save').click()
    cy.wait('@restPatch')
    cy.expectToast('შენახულია')
  })

  it('removes an admin member', () => {
    loadTeam()
    cy.getByTestId('member-delete').click()
    cy.wait('@restDelete')
    cy.expectToast('წაშლილია')
    cy.getByTestId('member-row').should('have.length', 1)
  })

  it('invites an admin by email', () => {
    loadTeam()
    cy.getByTestId('team-invite-btn').click()
    cy.getByTestId('invite-send').should('be.disabled')
    cy.getByTestId('invite-email').type('bad-email')
    cy.getByTestId('invite-send').should('be.disabled')
    cy.getByTestId('invite-email').clear().type('newadmin@example.com')
    cy.getByTestId('invite-send').click()
    cy.wait('@restPost')
    cy.expectToast('მოწვევა გაგზავნილია')
  })

  it('cancels a pending invitation', () => {
    loadTeam([{ id: 'inv-1', email: 'pending@example.com', phone_number: null, role: 'admin', expires_at: '2030-01-01', accepted_at: null }])
    cy.getByTestId('invite-row').should('exist')
    cy.getByTestId('invite-cancel').click()
    cy.wait('@restDelete')
    cy.expectToast('წაშლილია')
  })
})
