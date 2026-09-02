import { defineConfig, devices } from '@playwright/test'

/**
 * Pacing for the demo screencasts (e2e/demo.spec.ts) — the delay Playwright puts
 * before every action, which is what makes a recording watchable rather than a
 * blur. Higher = slower and calmer on camera. Override per take:
 *
 *     DEMO_SLOW_MO=2400 npm run demo
 */
const DEMO_SLOW_MO = Number(process.env.DEMO_SLOW_MO ?? 1800)

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
    // The test suite. Excludes the demo screencasts: they are ad creative, not
    // assertions, and recording four of them added ~5 min to every suite run.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /demo\.spec\.ts/,
    },
    // The screencasts. Slower pacing, and a video recorded at full viewport
    // resolution — Playwright otherwise scales the recording down to fit
    // 800x800, which for a 1280x720 viewport means shipping 800x450 footage to
    // an ad. No retries: a re-run would silently overwrite a good take, and
    // these are meant to be watched before use anyway.
    {
      name: 'demo',
      testMatch: /demo\.spec\.ts/,
      retries: 0,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: { slowMo: DEMO_SLOW_MO },
        // slowMo delays sit inside the action's own budget, so the default 15s
        // gets tight once pacing is turned up for filming.
        actionTimeout: 30_000,
        video: { mode: 'on', size: { width: 1280, height: 720 } },
        trace: 'off',
      },
    },
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
