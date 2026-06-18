/// <reference types="cypress" />
import { makeOrg, makeInvitation } from '../support/factories'

describe('Onboarding', () => {
  describe('access', () => {
    it('redirects an anonymous user to /login', () => {
      cy.visit('/onboarding/business')
      cy.location('pathname').should('eq', '/login')
    })
  })

  describe('step 1 — business profile', () => {
    beforeEach(() => {
      cy.login()
      cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
      cy.visit('/onboarding/business')
    })

    it('keeps Next disabled until name (2+) and a valid Georgian phone are present', () => {
      cy.getByTestId('biz-next').should('be.disabled')
      cy.getByTestId('biz-name').type('ა')
      cy.getByTestId('biz-phone').type('599 12 34 56')
      // Name too short still blocks.
      cy.getByTestId('biz-next').should('be.disabled')
      cy.getByTestId('biz-name').type('ბა') // now "აბა"
      cy.getByTestId('biz-next').should('not.be.disabled')
    })

    it('flags an invalid phone number', () => {
      cy.getByTestId('biz-name').type('სილამაზის სალონი')
      cy.getByTestId('biz-phone').type('12345')
      cy.getByTestId('biz-next').should('be.disabled')
    })

    it('advances to the services step when valid', () => {
      cy.getByTestId('biz-name').type('სილამაზის სალონი')
      cy.getByTestId('biz-phone').type('599 12 34 56')
      cy.getByTestId('biz-next').click()
      cy.location('pathname').should('eq', '/onboarding/services')
    })
  })

  describe('step 2 — services', () => {
    beforeEach(() => {
      cy.login()
      cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
      cy.visit('/onboarding/business')
      cy.getByTestId('biz-name').type('სილამაზის სალონი')
      cy.getByTestId('biz-phone').type('599 12 34 56')
      cy.getByTestId('biz-next').click()
    })

    it('adds, edits and deletes a service', () => {
      cy.getByTestId('onb-services-next').should('be.disabled')

      // Add
      cy.getByTestId('onb-service-name').type('სტრიჟკა')
      cy.getByTestId('onb-service-duration').clear().type('45')
      cy.getByTestId('onb-service-price').clear().type('30')
      cy.getByTestId('onb-service-save').click()
      cy.getByTestId('onb-service-row').should('have.length', 1).and('contain.text', 'სტრიჟკა')
      cy.getByTestId('onb-services-next').should('not.be.disabled')

      // Edit
      cy.getByTestId('onb-service-edit').click()
      cy.getByTestId('onb-service-name').clear().type('წვერის შეკრება')
      cy.getByTestId('onb-service-save').click()
      cy.getByTestId('onb-service-row').should('contain.text', 'წვერის შეკრება')

      // Delete
      cy.getByTestId('onb-service-delete').click()
      cy.getByTestId('onb-service-row').should('not.exist')
      cy.getByTestId('onb-services-next').should('be.disabled')
    })

    it('rejects a duration longer than 24h (1440 min)', () => {
      cy.getByTestId('onb-service-name').type('მარათონი')
      cy.getByTestId('onb-service-duration').clear().type('1500')
      cy.getByTestId('onb-service-save').should('be.disabled')
      cy.getByTestId('onb-service-duration').clear().type('1440')
      cy.getByTestId('onb-service-save').should('not.be.disabled')
    })
  })

  describe('step 3 — working hours & completion', () => {
    function fillThroughToHours() {
      cy.getByTestId('biz-name').type('სილამაზის სალონი')
      cy.getByTestId('biz-phone').type('599 12 34 56')
      cy.getByTestId('biz-next').click()
      cy.getByTestId('onb-service-name').type('სტრიჟკა')
      cy.getByTestId('onb-service-duration').clear().type('60')
      cy.getByTestId('onb-service-price').clear().type('50')
      cy.getByTestId('onb-service-save').click()
      cy.getByTestId('onb-services-next').click()
      cy.location('pathname').should('eq', '/onboarding/hours')
    }

    beforeEach(() => {
      cy.login()
      cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
      cy.visit('/onboarding/business')
    })

    it('shows a validation error when a day closes before it opens', () => {
      fillThroughToHours()
      // Monday is open 09:00–18:00 by default; make it close before it opens.
      cy.getByTestId('hours-monday-close').clear().type('07:00')
      cy.getByTestId('hours-finish').click()
      cy.getByTestId('hours-error').should('be.visible')
      cy.location('pathname').should('eq', '/onboarding/hours')
    })

    it('creates the organisation and lands on the dashboard', () => {
      const org = makeOrg()
      let created = false
      cy.mockSupabase({
        tables: {
          // Becomes the user's org only after the organisations insert fires.
          org_members: () => (created ? [{ role: 'owner', organisations: org }] : []),
          organisations: [org],
          appointments: [],
        },
        rpc: { search_appointments: [] },
      })
      cy.intercept('POST', '**/rest/v1/organisations*', (req) => {
        created = true
        req.reply({ statusCode: 201, body: [{ id: org.id }] })
      }).as('orgInsert')

      fillThroughToHours()
      cy.getByTestId('hours-finish').click()
      cy.wait('@orgInsert')
      cy.location('pathname').should('eq', '/dashboard')
      cy.contains('თქვენი ბუქინგ ბმული').should('be.visible')
    })

    it('lets the user skip onboarding straight to the (empty) dashboard', () => {
      cy.contains('button', 'გამოტოვება').click()
      cy.location('pathname').should('eq', '/dashboard')
      // No org → dashboard shows the "set up business" empty state.
      cy.contains('ბიზნესის შექმნა').should('be.visible')
    })
  })

  // BVA + equivalence partitioning for isValidGeorgianPhone, exercised through
  // the business-profile "Next" gate (name held valid). National number = 9
  // digits starting 3/4/5; +995 country code optional.
  describe('step 1 — phone validation (boundary / equivalence)', () => {
    const cases: { phone: string; valid: boolean; note: string }[] = [
      { phone: '599123456', valid: true, note: '9-digit mobile (5)' },
      { phone: '322123456', valid: true, note: 'landline (3)' },
      { phone: '412123456', valid: true, note: 'landline (4)' },
      { phone: '+995599123456', valid: true, note: 'with +995 country code' },
      { phone: '59912345', valid: false, note: '8 digits (one short)' },
      { phone: '5991234567', valid: false, note: '10 digits (one long)' },
      { phone: '299123456', valid: false, note: 'leading 2 (out of 3-5 set)' },
    ]
    cases.forEach(({ phone, valid, note }) => {
      it(`${note}: "${phone}" → ${valid ? 'valid' : 'invalid'}`, () => {
        cy.login()
        cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
        cy.visit('/onboarding/business')
        cy.getByTestId('biz-name').type('სალონი')
        cy.getByTestId('biz-phone').type(phone)
        cy.getByTestId('biz-next').should(valid ? 'not.be.disabled' : 'be.disabled')
      })
    })
  })

  // BVA on the business-name minimum length (>= 2 chars).
  describe('step 1 — name length boundary', () => {
    beforeEach(() => {
      cy.login()
      cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
      cy.visit('/onboarding/business')
      cy.getByTestId('biz-phone').type('599 12 34 56')
    })
    it('1 char is too short, 2 chars is accepted', () => {
      cy.getByTestId('biz-name').type('ა')
      cy.getByTestId('biz-next').should('be.disabled')
      cy.getByTestId('biz-name').type('ბ') // now 2 chars
      cy.getByTestId('biz-next').should('not.be.disabled')
    })
  })

  describe('pending invitation banner', () => {
    it('lets an invited user accept the invite from onboarding', () => {
      const org = makeOrg()
      let joined = false
      cy.login({ email: 'invitee@example.com' })
      cy.mockSupabase({
        tables: {
          org_members: () => (joined ? [{ role: 'admin', organisations: org }] : []),
          invitations: [{
            ...makeInvitation({ email: 'invitee@example.com', role: 'admin' }),
            organisations: { name: org.name },
            accepted_at: null,
          }],
          appointments: [],
        },
        rpc: {
          accept_invitation: () => { joined = true; return { ok: true } },
          search_appointments: [],
        },
      })
      cy.visit('/onboarding/business')
      cy.getByTestId('pending-invite').should('be.visible').and('contain.text', org.name)
      cy.getByTestId('pending-invite-accept').click()
      cy.location('pathname').should('eq', '/dashboard')
    })
  })
})
