/// <reference types="cypress" />
import { makeOrg } from '../support/factories'

const org = makeOrg()
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

const open = { open: true, ranges: [{ start: '09:00', end: '18:00' }] }
const closed = { open: false, ranges: [] }
const template = {
  id: 'tpl-1', org_id: org.id,
  monday: open, tuesday: open, wednesday: open, thursday: open, friday: open,
  saturday: closed, sunday: closed,
}

function loadHours(overrides: unknown[] = []) {
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
      working_hours_template: [template],
      working_hours_overrides: overrides,
    },
  })
  cy.visit('/dashboard/settings/hours')
}

describe('Settings — working hours', () => {
  it('renders the weekly template', () => {
    loadHours()
    cy.contains('ორშაბათი').should('be.visible')
    cy.getByTestId('wh-save').should('be.visible')
  })

  it('saves a valid template', () => {
    loadHours()
    cy.getByTestId('wh-monday-open').should('have.value', '09:00')
    cy.getByTestId('wh-save').click()
    cy.wait('@restPatch')
    cy.expectToast('შენახულია')
  })

  it('rejects a day that closes before it opens', () => {
    loadHours()
    cy.getByTestId('wh-monday-close').clear().type('07:00')
    cy.getByTestId('wh-save').click()
    cy.getByTestId('wh-error').should('be.visible')
  })

  // BVA on the open<close rule: equal times is the rejection boundary
  // (close must be strictly after open).
  it('rejects a day whose close time equals its open time', () => {
    loadHours()
    cy.getByTestId('wh-monday-close').clear().type('09:00') // equals the 09:00 open
    cy.getByTestId('wh-save').click()
    cy.getByTestId('wh-error').should('be.visible')
  })

  it('adds a date override', () => {
    let created = false
    cy.login()
    cy.mockSupabase({
      tables: {
        organisations: [org],
        org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
        working_hours_template: [template],
        working_hours_overrides: () =>
          created ? [{ id: 'ov-1', date: '2030-12-25', is_closed: true, ranges: null, note: 'შობა' }] : [],
      },
    })
    cy.intercept('POST', '**/rest/v1/working_hours_overrides*', (req) => {
      created = true
      req.reply({ statusCode: 201, body: req.body })
    }).as('ovInsert')
    cy.visit('/dashboard/settings/hours')

    cy.getByTestId('wh-override-add').click()
    cy.getByTestId('wh-ov-date').type('2030-12-25')
    cy.getByTestId('wh-ov-save').click()
    cy.wait('@ovInsert')
    cy.getByTestId('wh-override-row').should('have.length', 1)
  })

  it('deletes a date override after confirmation', () => {
    loadHours([{ id: 'ov-1', date: '2030-12-25', is_closed: true, ranges: null, note: 'შობა' }])
    cy.getByTestId('wh-override-row').should('have.length', 1)
    cy.getByTestId('wh-override-delete').click()
    cy.getByTestId('confirm-dialog-confirm').click()
    cy.wait('@restDelete')
    cy.expectToast('წაშლილია')
  })
})
