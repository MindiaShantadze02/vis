/// <reference types="cypress" />
import { makeOrg, makeAppointment } from '../support/factories'

const org = makeOrg()
// OrgContext loads membership via a join select `role, organisations(*)`; the
// bookable-members query selects plain columns. Both are array GETs on
// org_members (maybeSingle fetches as a list), so branch on the join select.
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

interface DashOpts {
  search?: unknown
  bookable?: unknown[]
  serviceStaff?: unknown[]
  appointments?: unknown
}

function loadDashboard(opts: DashOpts = {}) {
  cy.login()
  cy.mockSupabase({
    tables: {
      organisations: [org],
      // OrgContext wants a single joined row; the bookable-members query wants an array.
      org_members: (req) =>
        isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : (opts.bookable ?? []),
      service_staff: opts.serviceStaff ?? [],
      appointments: opts.appointments ?? [],
      invitations: [],
    },
    rpc: { search_appointments: opts.search ?? [] },
  })
  cy.visit('/dashboard')
}

describe('Dashboard — overview', () => {
  it('shows the empty state when the user has no organisation', () => {
    cy.login()
    cy.mockSupabase({ tables: { org_members: [], invitations: [] } })
    cy.visit('/dashboard')
    cy.contains('ბიზნესი ჯერ არ გაქვთ').should('be.visible')
    cy.contains('ბიზნესის შექმნა').should('be.visible')
  })

  it('renders the booking link and four stat cards', () => {
    loadDashboard()
    cy.contains('თქვენი ბუქინგ ბმული').should('be.visible')
    cy.contains(`grafiki.ge/book/${org.slug}`).should('be.visible')
    cy.getByTestId('stat-card').should('have.length', 4)
  })

  it('lists appointments and shows an empty state when none match', () => {
    loadDashboard({ search: [makeAppointment({ status: 'pending' })] })
    cy.getByTestId('appt-row').should('have.length', 1)

    // Re-mock with no results and reload.
    cy.mockSupabase({ rpc: { search_appointments: [] } })
    cy.reload()
    cy.contains('ჯავშნები ვერ მოიძებნა').should('be.visible')
  })

  it('filters by status via the dropdown', () => {
    const pendingRow = makeAppointment({ status: 'pending', customers: { first_name: 'პენდინგ', last_name: '', phone_number: '599 00 00 00' } })
    const approvedRow = makeAppointment({ status: 'approved', customers: { first_name: 'აპრუვდ', last_name: '', phone_number: '599 11 11 11' } })
    cy.login()
    cy.mockSupabase({
      tables: {
        organisations: [org],
        org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
        appointments: [],
        invitations: [],
      },
      rpc: {
        search_appointments: (req) => {
          const body = (req.body ?? {}) as { p_status?: string }
          if (body.p_status === 'pending') return [pendingRow]
          return [pendingRow, approvedRow]
        },
      },
    })
    cy.visit('/dashboard')
    cy.getByTestId('appt-row').should('have.length', 2)

    cy.get('[data-testid="appt-status-filter"]').click()
    cy.contains('[role="option"]', 'მოლოდინში').click()
    cy.getByTestId('appt-row').should('have.length', 1).and('contain.text', 'პენდინგ')
  })

  it('searches appointments (debounced) and shows no-results', () => {
    const match = makeAppointment({ customers: { first_name: 'გიორგი', last_name: 'მაისურაძე', phone_number: '599 00 00 00' } })
    cy.login()
    cy.mockSupabase({
      tables: {
        organisations: [org],
        org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
        appointments: [],
        invitations: [],
      },
      rpc: {
        search_appointments: (req) => {
          const body = (req.body ?? {}) as { p_search?: string }
          if (!body.p_search) return [match]
          return body.p_search.includes('გიორგი') ? [match] : []
        },
      },
    })
    cy.visit('/dashboard')
    cy.getByTestId('appt-search').type('გიორგი')
    cy.getByTestId('appt-row').should('have.length', 1)
    cy.getByTestId('appt-search').clear().type('არავინ')
    cy.contains('ჯავშნები ვერ მოიძებნა').should('be.visible')
  })

  it('paginates when there are more rows than the page size', () => {
    const page1 = Array.from({ length: 25 }, (_, i) =>
      makeAppointment({ id: `p1-${i}`, total_count: 30 }))
    const page2 = Array.from({ length: 5 }, (_, i) =>
      makeAppointment({ id: `p2-${i}`, total_count: 30 }))
    cy.login()
    cy.mockSupabase({
      tables: {
        organisations: [org],
        org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
        appointments: [],
        invitations: [],
      },
      rpc: {
        search_appointments: (req) => {
          const body = (req.body ?? {}) as { p_offset?: number }
          return (body.p_offset ?? 0) >= 25 ? page2 : page1
        },
      },
    })
    cy.visit('/dashboard')
    cy.getByTestId('appt-row').should('have.length', 25)
    cy.contains('1–25 / 30').should('be.visible')
    cy.get('.MuiTablePagination-actions button').last().click()
    cy.getByTestId('appt-row').should('have.length', 5)
  })

  // BVA: total exactly equal to the page size → a single page, next disabled.
  it('shows a single page when the total equals the page size', () => {
    const rows = Array.from({ length: 25 }, (_, i) => makeAppointment({ id: `r-${i}`, total_count: 25 }))
    cy.login()
    cy.mockSupabase({
      tables: {
        organisations: [org],
        org_members: (req) => (isOrgJoin(req) ? [{ role: 'owner', organisations: org }] : []),
        appointments: [],
        invitations: [],
      },
      rpc: { search_appointments: rows },
    })
    cy.visit('/dashboard')
    cy.getByTestId('appt-row').should('have.length', 25)
    cy.contains('1–25 / 25').should('be.visible')
    cy.get('.MuiTablePagination-actions button').last().should('be.disabled')
  })

  describe('row actions', () => {
    it('approves a pending appointment', () => {
      loadDashboard({ search: [makeAppointment({ status: 'pending' })] })
      cy.getByTestId('appt-row').first().click()
      cy.getByTestId('appt-approve').click()
      cy.wait('@restPatch')
      cy.expectToast('დამტკიცებული')
    })

    it('rejects a pending appointment', () => {
      loadDashboard({ search: [makeAppointment({ status: 'pending' })] })
      cy.getByTestId('appt-row').first().click()
      cy.getByTestId('appt-reject').click()
      cy.wait('@restPatch')
      cy.expectToast('უარყოფილი')
    })

    it('cancels an approved appointment with a two-step confirm', () => {
      loadDashboard({ search: [makeAppointment({ status: 'approved' })] })
      cy.getByTestId('appt-row').first().click()
      cy.getByTestId('appt-cancel').click()
      // First click only reveals the confirm/keep pair.
      cy.getByTestId('appt-confirm-cancel').should('be.visible')
      cy.getByTestId('appt-keep').should('be.visible')
      cy.getByTestId('appt-confirm-cancel').click()
      cy.wait('@restPatch')
      cy.expectToast('გაუქმებული')
    })

    it('reassigns staff from the detail dialog', () => {
      const appt = makeAppointment({ status: 'approved', service_id: 'svc-1' })
      loadDashboard({
        search: [appt],
        bookable: [{ id: 'mem-1', display_name: 'ნინო', title: 'სტილისტი' }],
        serviceStaff: [{ member_id: 'mem-1' }],
      })
      cy.getByTestId('appt-row').first().click()
      cy.get('[data-testid="appt-staff-select"]').click()
      cy.contains('[role="option"]', 'ნინო').click()
      cy.wait('@restPatch')
    })
  })

  describe('add appointment dialog', () => {
    it('opens, validates, and closes', () => {
      loadDashboard({ search: [] })
      cy.getByTestId('appt-add-btn').click()
      cy.getByTestId('add-appt-dialog').should('be.visible')
      // Save is disabled until a service, valid customer, date and time are set.
      cy.getByTestId('add-appt-save').should('be.disabled')
      cy.getByTestId('add-appt-first-name').type('გიორგი')
      cy.getByTestId('add-appt-phone').type('599 12 34 56')
      cy.getByTestId('add-appt-save').should('be.disabled')
      cy.getByTestId('add-appt-cancel').click()
      cy.getByTestId('add-appt-dialog').should('not.exist')
    })
  })
})
