/// <reference types="cypress" />
import { makeOrg, makeService, makeWorkingHours } from '../support/factories'

const org = makeOrg()
const NOW = new Date('2026-06-15T08:00:00').getTime() // Monday
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

const appt = {
  id: 'apt-1',
  scheduled_at: '2026-06-17T10:00:00', // Wed 10:00, inside the visible week
  duration_minutes: 60,
  service_id: 'svc-1',
  staff_id: null,
  status: 'pending',
  payment_method: 'in_person',
  payment_status: 'unpaid',
  notes: null,
  customers: { first_name: 'ლევანი', last_name: 'ხ', phone_number: '599 22 33 44' },
  services: { name: 'სტრიჟკა', price: 50 },
  staff: null,
}

function loadCalendar(appointments: unknown[] = [appt]) {
  cy.clock(NOW, ['Date'])
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
      working_hours_template: [makeWorkingHours()],
      working_hours_overrides: [],
      services: [makeService({ id: 'svc-1', name: 'სტრიჟკა' })],
      service_staff: [],
      appointments,
    },
  })
  cy.visit('/dashboard/calendar')
}

describe('Dashboard — calendar', () => {
  it('renders the week grid with an appointment pill', () => {
    loadCalendar()
    cy.getByTestId('cal-appt').should('have.length', 1).and('contain.text', 'ლევანი')
  })

  it('opens the detail drawer and approves a pending appointment', () => {
    loadCalendar()
    cy.getByTestId('cal-appt').click()
    cy.contains('სტრიჟკა').should('be.visible')
    cy.contains('599 22 33 44').should('be.visible')
    cy.getByTestId('cal-approve').click()
    cy.wait('@restPatch')
    // Drawer closes after the status change.
    cy.getByTestId('cal-approve').should('not.exist')
  })

  it('navigates between weeks', () => {
    loadCalendar()
    cy.getByTestId('cal-week-label').invoke('text').then((label) => {
      cy.getByTestId('cal-next').click()
      cy.getByTestId('cal-week-label').should('not.have.text', label)
      cy.getByTestId('cal-prev').click()
      cy.getByTestId('cal-week-label').should('have.text', label)
    })
  })

  it('opens the rest-period dialog', () => {
    loadCalendar([])
    cy.getByTestId('cal-rest-btn').click()
    cy.contains('დასვენების პერიოდი').should('be.visible')
  })

  it('shows an empty grid when there are no appointments', () => {
    loadCalendar([])
    cy.getByTestId('cal-appt').should('not.exist')
  })
})
