/// <reference types="cypress" />
import { makeOrg, makeService } from '../support/factories'

describe('Booking confirmation', () => {
  const org = makeOrg()
  const service = makeService()

  function confirmRow(status: string, payment: string) {
    return {
      id: 'apt-confirm', scheduled_at: '2026-07-01T10:00:00', duration_minutes: 60,
      status, payment_method: payment,
      organisations: { name: org.name, slug: org.slug, booking_theme: null },
      services: { name: service.name, price: service.price },
      customers: { first_name: 'გიორგი', last_name: null },
    }
  }

  it('shows a not-found state for an unknown appointment id', () => {
    cy.mockSupabase({ tables: { appointments: [] } })
    cy.visit('/booking-confirmation/missing')
    cy.contains('ჯავშანი ვერ მოიძებნა').should('be.visible')
  })

  it('shows the pending state for an in-person booking', () => {
    cy.mockSupabase({ tables: { appointments: [confirmRow('pending', 'in_person')] } })
    cy.visit('/booking-confirmation/apt-confirm')
    cy.contains('ჯავშანი მიღებულია!').should('be.visible')
    cy.getByTestId('status-pending').should('be.visible')
  })

  it('shows the approved state and lets the customer start another booking', () => {
    cy.mockSupabase({
      tables: {
        appointments: [confirmRow('approved', 'online')],
        organisations: [org],
        services: [service],
        working_hours_template: [],
        service_staff: [],
      },
    })
    cy.visit('/booking-confirmation/apt-confirm')
    cy.contains('ჯავშანი დადასტურებულია!').should('be.visible')
    cy.getByTestId('confirm-book-another').click()
    cy.location('pathname').should('eq', `/book/${org.slug}`)
    cy.contains('სერვისის არჩევა').should('be.visible')
  })
})
