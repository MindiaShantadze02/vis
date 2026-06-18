/// <reference types="cypress" />
import './commands'
import {
  resetSupabaseState, installSupabaseIntercepts, authStorageKey,
} from './supabase-mock'
import { getPendingSession, clearPendingSession } from './commands'

// Seed the auth session into localStorage *before* the app's JS runs, so
// supabase-js getSession() resolves the logged-in user with no network. This
// fires on every page load (cy.visit, reloads, client redirects).
Cypress.on('window:before:load', (win) => {
  const session = getPendingSession()
  if (session) {
    win.localStorage.setItem(authStorageKey(), session)
  }
})

// Supabase's realtime client can keep websockets open; the app doesn't use them,
// but swallow any stray "ResizeObserver loop" / network noise so specs don't
// fail on unrelated app errors. (Kept narrow on purpose.)
Cypress.on('uncaught:exception', (err) => {
  if (/ResizeObserver loop|Failed to fetch/.test(err.message)) return false
  return undefined
})

beforeEach(() => {
  resetSupabaseState()
  clearPendingSession()
  installSupabaseIntercepts()
})
