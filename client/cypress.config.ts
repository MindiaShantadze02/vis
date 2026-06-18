import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: 'cypress/fixtures',
    viewportWidth: 1280,
    viewportHeight: 800,
    video: false,
    experimentalRunAllSpecs: true,
    // The app is a pure SPA whose backend is fully stubbed via cy.intercept, so
    // there is nothing for setupNodeEvents to do — keep it as a no-op hook.
    setupNodeEvents() {},
  },
})
