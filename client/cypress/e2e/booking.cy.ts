/// <reference types="cypress" />
import { makeOrg, makeService, makeWorkingHours } from '../support/factories'

// A fixed Monday morning so the week grid and available slots are deterministic.
const NOW = new Date('2026-06-15T08:00:00').getTime()
const OPEN_DAY = 'book-day-2026-06-17'   // Wednesday — open
const CLOSED_DAY = 'book-day-2026-06-20' // Saturday — closed

const isSingle = (req: { url: string; headers: Record<string, string | string[]> }) =>
  String(req.headers['accept'] ?? '').includes('vnd.pgrst.object')

describe('Public booking', () => {
  it('shows a not-found state for an unknown business slug', () => {
    cy.visit('/book/does-not-exist')
    cy.contains('ბიზნესი ვერ მოიძებნა').should('be.visible')
  })

  describe('with a configured business', () => {
    const org = makeOrg({ payment_config: { inPerson: { enabled: true }, bog: { enabled: true } } })
    const service = makeService({ name: 'სტრიჟკა', duration_minutes: 60, price: 50, max_per_slot: 1 })

    function setupBooking(over: Partial<Record<string, unknown>> = {}) {
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
          ...over,
        },
      })
      cy.visit(`/book/${org.slug}`)
    }

    it('lists active services with duration and price', () => {
      const second = makeService({ name: 'წვერი', duration_minutes: 30, price: 20 })
      setupBooking({ services: [service, second] })
      cy.getByTestId('book-service').should('have.length', 2)
      cy.getByTestId('book-service').first().should('contain.text', 'სტრიჟკა').and('contain.text', '50 ₾')
      cy.getByTestId('book-service').first().should('contain.text', '60 წუთი')
    })

    it('shows an empty state when the business has no services', () => {
      setupBooking({ services: [] })
      cy.contains('სერვისები ჯერ არ არის დამატებული').should('be.visible')
    })

    it('disables closed days and lists slots on an open day', () => {
      setupBooking()
      cy.getByTestId('book-service').first().click()
      cy.getByTestId(CLOSED_DAY).should('have.attr', 'data-disabled', 'true')
      cy.getByTestId(OPEN_DAY).should('have.attr', 'data-disabled', 'false').click()
      cy.getByTestId('book-slot').should('have.length.greaterThan', 0)
      cy.getByTestId('book-slot').first().should('contain.text', '09:00')
    })

    it('navigates back from the date step to the service step', () => {
      setupBooking()
      cy.getByTestId('book-service').first().click()
      cy.contains('თარიღის არჩევა').should('be.visible')
      cy.contains('button', 'უკან').click()
      cy.contains('სერვისის არჩევა').should('be.visible')
    })

    it('offers staff selection (incl. "any available") when the service has assigned people', () => {
      setupBooking({
        service_staff: [{
          member_id: 'mem-1',
          org_members: { id: 'mem-1', display_name: 'ნინო', title: 'სტილისტი', is_bookable: true, sort_order: 0 },
        }],
      })
      cy.getByTestId('book-service').first().click()
      // "Any available" + one named member.
      cy.getByTestId('book-staff').should('have.length', 2)
      cy.get('[data-testid="book-staff"][data-staff-id="mem-1"]').click()
      cy.getByTestId(OPEN_DAY).click()
      cy.getByTestId('book-slot').should('have.length.greaterThan', 0)
    })

    function goToDetails() {
      cy.getByTestId('book-service').first().click()
      cy.getByTestId(OPEN_DAY).click()
      cy.getByTestId('book-slot').first().click()
      cy.contains('თქვენი მონაცემები').should('be.visible')
    }

    it('validates the customer form (name length + phone)', () => {
      setupBooking()
      goToDetails()
      cy.getByTestId('book-submit').should('be.disabled')
      cy.getByTestId('book-first-name').type('გ')
      cy.getByTestId('book-phone').type('123')
      cy.getByTestId('book-submit').should('be.disabled')
      cy.getByTestId('book-first-name').type('იორგი')
      cy.getByTestId('book-phone').clear().type('599 12 34 56')
      cy.getByTestId('book-submit').should('not.be.disabled')
    })

    // BVA on the first-name minimum (>= 2): exactly 2 chars is the lower bound.
    it('accepts a first name of exactly 2 chars (boundary)', () => {
      setupBooking()
      goToDetails()
      cy.getByTestId('book-first-name').type('აბ')
      cy.getByTestId('book-phone').type('599 12 34 56')
      cy.getByTestId('book-submit').should('not.be.disabled')
    })

    // Equivalence partitioning on per-slot capacity: one existing booking of the
    // same service is below a cap of 2 (slot stays) but meets a cap of 1 (slot drops).
    it('keeps a slot available while below capacity (max_per_slot = 2)', () => {
      const svc = makeService({ id: 'svc-cap', name: 'სტრიჟკა', duration_minutes: 60, price: 50, max_per_slot: 2 })
      setupBooking({
        services: [svc],
        appointments: (req) => (isSingle(req) ? [] : [
          { scheduled_at: '2026-06-17T09:00:00', duration_minutes: 60, service_id: 'svc-cap', staff_id: null },
        ]),
      })
      cy.getByTestId('book-service').first().click()
      cy.getByTestId(OPEN_DAY).click()
      cy.getByTestId('book-slot').first().should('contain.text', '09:00')
    })

    it('drops a slot once capacity is reached (max_per_slot = 1)', () => {
      const svc = makeService({ id: 'svc-cap', name: 'სტრიჟკა', duration_minutes: 60, price: 50, max_per_slot: 1 })
      setupBooking({
        services: [svc],
        appointments: (req) => (isSingle(req) ? [] : [
          { scheduled_at: '2026-06-17T09:00:00', duration_minutes: 60, service_id: 'svc-cap', staff_id: null },
        ]),
      })
      cy.getByTestId('book-service').first().click()
      cy.getByTestId(OPEN_DAY).click()
      // 09:00 is full → first available start is 10:00.
      cy.getByTestId('book-slot').should('have.length.greaterThan', 0)
      cy.getByTestId('book-slot').first().should('not.contain.text', '09:00')
    })

    it('completes an in-person booking → pending confirmation (full journey)', () => {
      const confirmRow = {
        id: 'apt-confirm', scheduled_at: '2026-06-17T09:00:00', duration_minutes: 60,
        status: 'pending', payment_method: 'in_person',
        organisations: { name: org.name, slug: org.slug, booking_theme: null },
        services: { name: service.name, price: service.price },
        customers: { first_name: 'გიორგი', last_name: 'მაისურაძე' },
      }
      // Empty for the slot/recheck array reads; the joined confirmation row for the
      // single() read on the confirmation page.
      setupBooking({ appointments: (req) => (isSingle(req) ? [confirmRow] : []) })

      goToDetails()
      cy.getByTestId('book-first-name').type('გიორგი')
      cy.getByTestId('book-phone').type('599 12 34 56')
      cy.getByTestId('book-pay-in_person').click()
      cy.getByTestId('book-submit').click()

      cy.wait('@restPost') // customer insert
      cy.location('pathname').should('include', '/booking-confirmation/')
      cy.contains('ჯავშანი მიღებულია!').should('be.visible')
      cy.getByTestId('status-pending').should('be.visible')
    })

    it('completes an online booking → approved confirmation', () => {
      const confirmRow = {
        id: 'apt-confirm', scheduled_at: '2026-06-17T09:00:00', duration_minutes: 60,
        status: 'approved', payment_method: 'online',
        organisations: { name: org.name, slug: org.slug, booking_theme: null },
        services: { name: service.name, price: service.price },
        customers: { first_name: 'გიორგი', last_name: null },
      }
      setupBooking({ appointments: (req) => (isSingle(req) ? [confirmRow] : []) })

      goToDetails()
      cy.getByTestId('book-first-name').type('გიორგი')
      cy.getByTestId('book-phone').type('599 12 34 56')
      cy.getByTestId('book-pay-online').click()
      cy.getByTestId('book-submit').click()

      cy.location('pathname').should('include', '/booking-confirmation/')
      cy.contains('ჯავშანი დადასტურებულია!').should('be.visible')
      cy.getByTestId('status-approved').should('be.visible')
    })

    it('errors when the slot fills between selection and submit (race)', () => {
      setupBooking()
      goToDetails()
      cy.getByTestId('book-first-name').type('გიორგი')
      cy.getByTestId('book-phone').type('599 12 34 56')

      // The chosen slot is now taken by another booking of the same service.
      cy.intercept('GET', '**/rest/v1/appointments*', [{
        scheduled_at: '2026-06-17T09:00:00', duration_minutes: 60, service_id: service.id, staff_id: null,
      }]).as('recheck')
      cy.getByTestId('book-submit').click()
      cy.getByTestId('book-error').should('be.visible')
      cy.location('pathname').should('include', `/book/${org.slug}`)
    })

    it('surfaces a backend rejection (e.g. subscription limit reached)', () => {
      setupBooking()
      goToDetails()
      cy.getByTestId('book-first-name').type('გიორგი')
      cy.getByTestId('book-phone').type('599 12 34 56')

      cy.intercept('POST', '**/rest/v1/appointments*', {
        statusCode: 403,
        body: { message: 'ლიმიტი ამოიწურა', code: 'P0001' },
      }).as('apptInsert')
      cy.getByTestId('book-submit').click()
      cy.getByTestId('book-error').should('be.visible').and('contain.text', 'ლიმიტი')
    })
  })
})
