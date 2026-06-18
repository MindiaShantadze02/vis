/// <reference types="cypress" />
import { makeOrg } from '../support/factories'

const org = makeOrg()
const isOrgJoin = (req: { url: string; headers: Record<string, string | string[]> }) =>
  decodeURIComponent(req.url).includes('organisations(')

describe('Invitation acceptance (/invite/:token)', () => {
  it('prompts an anonymous visitor to log in', () => {
    cy.visit('/invite/some-token')
    cy.contains('მოწვევის მისაღებად შედით სისტემაში').should('be.visible')
    cy.contains('button', 'შესვლა').click()
    cy.location('pathname').should('eq', '/login')
  })

  it('accepts the invitation for a logged-in user and offers the dashboard', () => {
    cy.login()
    cy.mockSupabase({
      tables: { org_members: (req) => (isOrgJoin(req) ? [{ role: 'admin', organisations: org }] : []) },
      rpc: { accept_invitation: { ok: true } },
    })
    cy.visit('/invite/good-token')
    cy.contains('მოწვევა მიღებულია').should('be.visible')
    cy.contains('button', 'დაშბორდზე გადასვლა').click()
    cy.location('pathname').should('eq', '/dashboard')
  })

  it('shows an "expired" error', () => {
    cy.login()
    cy.mockSupabase({ rpc: { accept_invitation: { ok: false, error: 'expired' } } })
    cy.visit('/invite/expired-token')
    cy.contains('მოწვევის ვადა გავიდა').should('be.visible')
  })

  it('shows an "already a member" error', () => {
    cy.login()
    cy.mockSupabase({ rpc: { accept_invitation: { ok: false, error: 'already_in_org' } } })
    cy.visit('/invite/dup-token')
    cy.contains('თქვენ უკვე ხართ ორგანიზაციის წევრი').should('be.visible')
  })

  it('shows a "wrong account" error', () => {
    cy.login()
    cy.mockSupabase({ rpc: { accept_invitation: { ok: false, error: 'wrong_account' } } })
    cy.visit('/invite/other-token')
    cy.contains('ეს მოწვევა სხვა ანგარიშზეა გაგზავნილი').should('be.visible')
  })

  it('shows a "not found / already used" error', () => {
    cy.login()
    cy.mockSupabase({ rpc: { accept_invitation: { ok: false, error: 'not_found' } } })
    cy.visit('/invite/gone-token')
    cy.contains('მოწვევა ვერ მოიძებნა ან უკვე გამოყენებულია').should('be.visible')
  })

  // Equivalence: any unrecognised result code falls back to the generic message.
  it('falls back to a generic message for an unknown result code', () => {
    cy.login()
    cy.mockSupabase({ rpc: { accept_invitation: { ok: false, error: 'something_unexpected' } } })
    cy.visit('/invite/weird-token')
    cy.contains('მოწვევის მიღება ვერ მოხერხდა').should('be.visible')
  })

  // The other failure partition: a transport/RPC-level error (not an { ok:false }
  // result) surfaces the raw error message.
  it('surfaces an RPC-level error message', () => {
    cy.login()
    cy.mockSupabase({
      rpc: { accept_invitation: () => ({ statusCode: 400, body: { message: 'rpc exploded', code: 'P0001' } }) },
    })
    cy.visit('/invite/boom-token')
    cy.contains('rpc exploded').should('be.visible')
  })
})
