import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the real dev server + the hosted Supabase backend
// (the same setup used for manual QA), NOT a stubbed backend. Two consequences:
//   • Tests are serial (workers: 1) — they share one hosted database and a small
//     set of seeded accounts, so parallelism would cause data races.
//   • Some flows create real rows (a booking, a throwaway signup). Specs that can
//     self-clean do so; see e2e/README.md for what persists.
//
// Booking OTP uses the temporary master code 000000 (see e2e/helpers.ts).
export default defineConfig({
  testDir: './e2e',
  // Frees the shared seed calendar before each run — booking specs accumulate
  // real appointments and a saturated calendar fails ~13 unrelated specs at the
  // day strip. No-ops without a service-role key. See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // Live network + OTP round-trips are occasionally flaky; one retry absorbs that.
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    launchOptions: {
      slowMo: 1000
    },
    video: 'on'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Reuse an already-running `npm run dev`; otherwise start one. The dev server
  // is configured (client/.env) to talk to the hosted Supabase project.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
