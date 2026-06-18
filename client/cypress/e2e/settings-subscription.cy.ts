/// <reference types="cypress" />
import { makeOrg } from '../support/factories'

const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

function loadSubscription(tier: string, usage: { used: number; appt_limit: number | null }) {
  const org = makeOrg({ subscription_tier: tier })
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
    },
    // maybeSingle fetches as a list, so org_usage_info returns a one-row array.
    rpc: { org_usage_info: [{ ...usage, period_end: '2030-01-31' }] },
  })
  cy.visit('/dashboard/settings/subscription')
}

describe('Settings — subscription', () => {
  it('renders all four tiers and marks the current one', () => {
    loadSubscription('pro', { used: 100, appt_limit: 600 })
    cy.contains('უფასო').should('be.visible')
    cy.contains('სტარტერი').should('be.visible')
    cy.contains('პრო').should('be.visible')
    cy.contains('ბიზნესი').should('be.visible')
    cy.contains('მიმდინარე').should('be.visible')
  })

  it('shows the usage figure from org_usage_info', () => {
    loadSubscription('pro', { used: 100, appt_limit: 600 })
    cy.contains('100 / 600').should('be.visible')
  })

  // BVA on the 80% near-limit threshold: 480/600 = exactly 80% warns…
  it('warns when usage is near the limit (80%+)', () => {
    loadSubscription('pro', { used: 480, appt_limit: 600 })
    cy.contains('ლიმიტის 80%').should('be.visible')
  })

  // …and 470/600 (~78%) is just below the threshold, so no warning.
  it('does not warn just below the 80% threshold', () => {
    loadSubscription('pro', { used: 470, appt_limit: 600 })
    cy.contains('470 / 600').should('be.visible')
    cy.contains('ლიმიტის 80%').should('not.exist')
  })

  // BVA on the limit: used == limit is the "reached" boundary.
  it('shows a limit-reached message when usage equals the limit', () => {
    loadSubscription('starter', { used: 200, appt_limit: 200 })
    cy.contains('ჯავშნების ლიმიტი ამოიწურა').should('be.visible')
  })

  // Equivalence: an unlimited (null limit) plan never warns and renders ∞.
  it('shows ∞ and no warnings for an unlimited plan', () => {
    loadSubscription('business', { used: 5000, appt_limit: null })
    cy.contains('5000 / ∞').should('be.visible')
    cy.contains('ლიმიტის 80%').should('not.exist')
    cy.contains('ჯავშნების ლიმიტი ამოიწურა').should('not.exist')
  })
})
