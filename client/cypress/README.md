# Cypress E2E tests

Functional end-to-end tests for the vis client. The Supabase backend is
**fully mocked** at the HTTP level (`cy.intercept`), so the suite is
deterministic, offline, and creates no real data.

## Running

```bash
# one terminal: start the app
npm run dev            # http://localhost:5173

# another terminal
npm run cy:open        # interactive runner
npm run cy:run         # headless

# or boot + run in one go
npm run test:e2e
```

## How it works

- **`support/supabase-mock.ts`** — intercepts GoTrue auth (`/auth/v1/*`),
  PostgREST tables (`/rest/v1/<table>`), RPCs (`/rest/v1/rpc/<fn>`) and storage.
  Responses are driven by a per-test `state` object: `cy.mockSupabase({ tables, rpc, ... })`.
  A table/rpc entry may be a literal array/value or a `(req) => …` function for
  request-aware responses (e.g. branching on filters or read-after-write).
- **`support/commands.ts`** — `cy.login()` seeds a Supabase session into
  `localStorage` before the app loads; `cy.seedOrg()`, `cy.getByTestId()`,
  `cy.expectToast()`, `cy.logout()`.
- **`support/factories.ts`** — builders for orgs, services, members,
  appointments, invitations and working hours.
- Selectors use **`data-testid`** attributes added to the source components, so
  tests don't depend on the (Georgian) UI copy.

### Notes / gotchas

- `.maybeSingle()` in this `postgrest-js` version fetches as a **list** (no
  `vnd.pgrst.object` Accept header), unlike `.single()`. Where a table is read
  both as a joined single (OrgContext: `organisations(*)`) and as a plain list
  (e.g. bookable members), the mock branches on the `select` query, not the
  Accept header.
- Slot-grid and calendar specs freeze time with `cy.clock(NOW, ['Date'])` so the
  visible week and available slots are deterministic.
- If Cypress fails to start with `bad option: --smoke-test`, the shell has
  `ELECTRON_RUN_AS_NODE=1` set (it makes Electron run as plain Node). Unset it:
  `env -u ELECTRON_RUN_AS_NODE npm run cy:run`.
