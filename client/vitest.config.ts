import { defineConfig } from 'vitest/config'

// Unit-test layer for pure logic (src/lib/**). Kept separate from the Playwright
// e2e suite (client/e2e): these run in Node with no browser/back-end and give us
// the objective statement/branch coverage number for the validators.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Scoped to the pure-logic modules this suite targets (100% stmt/branch/fn).
      // Follow-up candidates for the same treatment: src/lib/slots.ts (availability
      // computation), authErrors.ts, dateLocale.ts.
      include: [
        'src/lib/validation.ts', 'src/lib/slug.ts', 'src/lib/tiers.ts',
        'src/lib/refund.ts', 'src/lib/storageImage.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
})
