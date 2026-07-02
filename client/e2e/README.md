# End-to-end tests (Playwright)

These are **live** e2e tests: they drive the real dev server, which talks to the
**hosted Supabase** backend (the same setup used for manual QA). They are not
stubbed. Booking phone-verification uses the temporary master OTP `000000`.

## Run

```bash
# from client/
npm run dev              # in one terminal (or let Playwright start it)
npm run e2e              # headless
npm run e2e:headed       # watch it run
npm run e2e:ui           # interactive UI mode
npm run e2e:report       # open the last HTML report
```

The config reuses an already-running dev server on :5173, or starts one.

## What's covered

| Spec | Flow |
|------|------|
| `auth.spec.ts` | login, bad-password error, logout, phone signup → onboarding |
| `onboarding.spec.ts` | full 3-step onboarding → org created (self-cleans by deleting the account) |
| `booking.spec.ts` | public in-person booking + OTP → confirmation; unknown-slug state |
| `dashboard.spec.ts` | overview stats + booking link, add-appointment dialog, calendar nav |
| `settings-services.spec.ts` | service create → edit → delete (self-cleans) |
| `settings-team.spec.ts` | add/delete a professional; invite admin by phone + cancel (self-clean) |

## Test data & the seeded account

Authenticated specs log in as the seeded owner in `helpers.ts` (`SEED`):
`555108509` / `password123`, org **Test Appointments Studio**
(`/book/test-appointments-studio`, service "Consultation"). Keep that account and
its active service + Mon–Fri hours intact, or the booking/dashboard specs will fail.

## What persists (not self-cleaned)

- **`booking.spec.ts`** creates a real pending appointment + customer on the seeded
  org each successful run (a guest can't self-delete). Reject/prune them from the
  dashboard periodically.
- **`auth.spec.ts`** "signup" test leaves a throwaway auth user (no org). Only the
  `onboarding.spec.ts` account self-deletes.

Because everything shares one hosted DB and one seeded account, the suite runs
**serially** (`workers: 1`). Don't switch it to parallel without per-worker orgs.

## Requirements / gotchas

- The `000000` booking-OTP bypass must be enabled on the backend (temporary, test-only).
- Georgian is the default locale, so specs assert some Georgian strings and the
  delete-account confirm word (`წაშლა`).
