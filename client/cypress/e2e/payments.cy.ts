/// <reference types="cypress" />
import { makeOrg, makeService, makeWorkingHours } from '../support/factories'

// Fixed Monday so the week grid + slots are deterministic (mirrors booking.cy.ts).
const NOW = new Date('2026-06-15T08:00:00').getTime()
const OPEN_DAY = 'book-day-2026-06-17' // Wednesday — open

const isOrgJoin = (req: { url: string }) =>
  decodeURIComponent(req.url).includes('organisations(')

// OTP edge functions always succeed in these specs — phone verification is
// covered elsewhere; here we care about what happens around payment.
const OTP_OK = {
  'request-booking-otp': { ok: true },
  'verify-booking-otp': { verified: true },
}

describe('Payments', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Online booking → hands off to the payment gateway (no appointment created
  // client-side; that now happens in the webhook only on success).
  // ──────────────────────────────────────────────────────────────────────────
  describe('online booking checkout hand-off', () => {
    const org = makeOrg({ payment_config: { inPerson: { enabled: true }, bog: { enabled: true } } })
    const service = makeService({ name: 'სტრიჟკა', duration_minutes: 60, price: 50, max_per_slot: 1 })

    function setupBooking(funcs: Record<string, unknown> = {}) {
      cy.clock(NOW, ['Date'])
      cy.mockSupabase({
        tables: {
          organisations: [org],
          services: [service],
          working_hours_template: [makeWorkingHours()],
          service_staff: [],
          working_hours_overrides: [],
          appointments: [],
          customers: [],
        },
        functions: { ...OTP_OK, ...funcs },
      })
      cy.visit(`/book/${org.slug}`)
    }

    function reachPayOnline() {
      cy.getByTestId('book-service').first().click()
      cy.getByTestId(OPEN_DAY).click()
      cy.getByTestId('book-slot').first().click()
      cy.getByTestId('book-first-name').type('გიორგი')
      cy.getByTestId('book-phone').type('599 12 34 56')
      cy.getByTestId('book-pay-online').click()
      cy.getByTestId('book-submit').click()
      // OTP gate.
      cy.getByTestId('book-otp-code').type('123456')
      cy.getByTestId('book-otp-verify').click()
    }

    it('redirects to the checkout URL returned by create-payment', () => {
      setupBooking({ 'create-payment': { checkoutUrl: '/pay/mock?ref=mock_1&purpose=appointment&id=pb-1&amount=50&currency=GEL&label=სტრიჟკა&slug=test-biz' } })
      reachPayOnline()
      cy.location('pathname').should('eq', '/pay/mock')
    })

    it('sends the booking payload (server recomputes price) to create-payment', () => {
      // Dedicated intercept wins over the global one for this route, so we can
      // assert the request body. OTP calls still hit the global stub.
      cy.intercept('POST', '**/functions/v1/create-payment', {
        statusCode: 200,
        body: { checkoutUrl: '/pay/mock?ref=mock_1&purpose=appointment&id=pb-1' },
      }).as('createPayment')
      setupBooking()
      reachPayOnline()
      cy.wait('@createPayment').its('request.body').should('deep.include', {
        purpose: 'appointment',
        org_id: org.id,
        service_id: service.id,
        slug: 'test-biz',
        first_name: 'გიორგი',
      })
      // No price is sent — the function reads it from the service.
      cy.get('@createPayment').its('request.body').should('not.have.property', 'amount')
      cy.location('pathname').should('eq', '/pay/mock')
    })

    it('shows an error and creates no booking when create-payment fails', () => {
      setupBooking({ 'create-payment': { statusCode: 500, body: { error: 'boom' } } })
      reachPayOnline()
      cy.getByTestId('book-error').should('be.visible')
      // Still on the booking page — nothing was created and nothing redirected.
      cy.location('pathname').should('eq', `/book/${org.slug}`)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Mock checkout screen (stands in for the bank gateway's hosted page).
  // ──────────────────────────────────────────────────────────────────────────
  describe('mock checkout screen', () => {
    // Built like the real provider does (URLSearchParams encodes the unicode
    // label) — cy.visit rejects raw non-ASCII characters in the query string.
    const APPT_URL = `/pay/mock?${new URLSearchParams({
      ref: 'mock_1', purpose: 'appointment', id: 'pb-1',
      amount: '50', currency: 'GEL', label: 'სტრიჟკა', slug: 'test-biz',
    }).toString()}`

    it('shows the amount and forwards a successful payment to the return page', () => {
      cy.mockSupabase({ functions: { 'payment-webhook': { ok: true, outcome: 'paid', appointment_id: 'apt-1' } } })
      cy.visit(APPT_URL)
      cy.contains('50 ₾').should('be.visible')
      cy.getByTestId('mock-pay-success').click()
      cy.location('pathname').should('eq', '/payment-return')
      cy.location('search').should('include', 'outcome=paid').and('include', 'id=apt-1')
      cy.contains('გადახდა წარმატებულია').should('be.visible')
    })

    it('forwards a simulated failure to the return page', () => {
      cy.mockSupabase({ functions: { 'payment-webhook': { ok: true, outcome: 'failed' } } })
      cy.visit(APPT_URL)
      cy.getByTestId('mock-pay-fail').click()
      cy.location('pathname').should('eq', '/payment-return')
      cy.location('search').should('include', 'outcome=failed')
      cy.contains('გადახდა ვერ შესრულდა').should('be.visible')
    })

    it('stays put and shows an error if settlement errors out', () => {
      cy.mockSupabase({ functions: { 'payment-webhook': { statusCode: 500, body: { error: 'boom' } } } })
      cy.visit(APPT_URL)
      cy.getByTestId('mock-pay-success').click()
      cy.contains('გადახდის დასრულება ვერ მოხერხდა').should('be.visible')
      cy.location('pathname').should('eq', '/pay/mock')
    })

    it('rejects an invalid session (missing params) and disables the buttons', () => {
      cy.visit('/pay/mock')
      cy.contains('გადახდის სესია არასწორია').should('be.visible')
      cy.getByTestId('mock-pay-success').should('be.disabled')
      cy.getByTestId('mock-pay-fail').should('be.disabled')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Payment return page — routes the user onward by purpose + outcome.
  // ──────────────────────────────────────────────────────────────────────────
  describe('payment return page', () => {
    it('a successful appointment links through to the booking confirmation', () => {
      cy.mockSupabase({
        tables: {
          appointments: [{
            id: 'apt-1', scheduled_at: '2026-06-17T09:00:00', duration_minutes: 60,
            status: 'approved', payment_method: 'online',
            organisations: { name: 'ტესტ ბიზნესი', slug: 'test-biz', booking_theme: null },
            services: { name: 'სტრიჟკა', price: 50 },
            customers: { first_name: 'გიორგი', last_name: null },
          }],
        },
      })
      cy.visit('/payment-return?purpose=appointment&id=apt-1&outcome=paid&slug=test-biz')
      cy.contains('გადახდა წარმატებულია').should('be.visible')
      cy.contains('თქვენი ჯავშანი დადასტურდა').should('be.visible')
      cy.getByTestId('payment-return-primary').click()
      cy.location('pathname').should('eq', '/booking-confirmation/apt-1')
    })

    it('a failed appointment routes back to the booking page (nothing created)', () => {
      cy.clock(NOW, ['Date'])
      cy.mockSupabase({
        tables: {
          organisations: [makeOrg()],
          services: [makeService()],
          working_hours_template: [makeWorkingHours()],
          service_staff: [], working_hours_overrides: [], appointments: [],
        },
      })
      cy.visit('/payment-return?purpose=appointment&outcome=failed&slug=test-biz')
      cy.contains('გადახდა ვერ შესრულდა').should('be.visible')
      cy.contains('თანხა არ ჩამოჭრილა').should('be.visible')
      cy.getByTestId('payment-return-primary').click()
      cy.location('pathname').should('eq', '/book/test-biz')
    })

    it('a successful subscription shows the upgrade message', () => {
      cy.visit('/payment-return?purpose=subscription&id=sp-1&outcome=paid')
      cy.contains('გადახდა წარმატებულია').should('be.visible')
      cy.contains('თქვენი გეგმა განახლდა').should('be.visible')
      cy.getByTestId('payment-return-primary').should('contain.text', 'გამოწერაზე დაბრუნება')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Subscription upgrade (business pays vis).
  // ──────────────────────────────────────────────────────────────────────────
  describe('subscription upgrade', () => {
    const org = makeOrg({ subscription_tier: 'free' })

    function loadSubscription(funcs: Record<string, unknown> = {}) {
      cy.login()
      cy.mockSupabase({
        tables: {
          organisations: [org],
          org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
        },
        rpc: { org_usage_info: [{ used: 5, appt_limit: 30, period_end: '2030-01-31' }] },
        functions: funcs,
      })
      cy.visit('/dashboard/settings/subscription')
    }

    it('upgrade sends the subscription request and redirects to checkout', () => {
      cy.intercept('POST', '**/functions/v1/create-payment', {
        statusCode: 200,
        body: { checkoutUrl: '/pay/mock?ref=mock_2&purpose=subscription&id=sp-1&amount=15&currency=GEL&label=vis%20starter' },
      }).as('createPayment')
      loadSubscription()
      // current tier is free → starter is the first upgradeable tier.
      cy.contains('button', 'განახლება').first().click()
      cy.wait('@createPayment').its('request.body').should('deep.include', {
        purpose: 'subscription',
        org_id: org.id,
        tier: 'starter',
      })
      cy.location('pathname').should('eq', '/pay/mock')
    })

    it('stays on the page and re-enables the button if create-payment fails', () => {
      loadSubscription({ 'create-payment': { statusCode: 500, body: { error: 'boom' } } })
      cy.contains('button', 'განახლება').first().click()
      cy.location('pathname').should('eq', '/dashboard/settings/subscription')
      cy.contains('button', 'განახლება').first().should('not.be.disabled')
    })
  })
})
