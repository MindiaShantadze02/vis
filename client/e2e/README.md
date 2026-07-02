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

Happy paths + edge cases (validation gating, route guards, error states):

| Spec | Flows | Edge cases |
|------|-------|-----------|
| `auth.spec.ts` | login, logout, phone signup → onboarding | bad password, unknown phone, duplicate-phone signup, mismatch/invalid-phone gating, protected-route redirect, logged-in `/login` redirect, forgot-password gating |
| `onboarding.spec.ts` | full 3-step onboarding → org (self-cleans) | step-1 "next" gating, skip → dashboard, org-guard bounce |
| `booking.spec.ts` | public in-person booking + OTP → confirmation | unknown slug, invalid name/phone gating, **wrong OTP rejected** |
| `dashboard.spec.ts` | overview stats + link, add-appt dialog, calendar nav | add-appt save gating |
| `settings-services.spec.ts` | service create → edit → delete (self-cleans) | save gating (empty name / out-of-range price / bad duration) |
| `settings-team.spec.ts` | add/delete professional; invite by phone + cancel (self-clean) | invite-send gating, add-professional name gating |

## Test data & the seeded account

Authenticated specs log in as the seeded owner in `helpers.ts` (`SEED`):
`555108509` / `password123`, org **Test Appointments Studio**
(`/book/test-appointments-studio`, service "Consultation"). Keep that account and
its active service + Mon–Fri hours intact, or the booking/dashboard specs will fail.

## What persists (not self-cleaned)

- **`booking.spec.ts`** creates a real pending appointment + customer on the seeded
  org each successful run (a guest can't self-delete). Reject/prune them from the
  dashboard periodically.
- Register-based tests (`auth` signup, `onboarding` "next"-gating and skip) each
  leave a throwaway auth user with **no org**. Only the full `onboarding` happy
  path self-deletes its account. Prune the rest with:
  `delete from auth.users u where u.created_at > now() - interval '1 hour'
   and not exists (select 1 from org_members m where m.user_id = u.id);`

Because everything shares one hosted DB and one seeded account, the suite runs
**serially** (`workers: 1`). Don't switch it to parallel without per-worker orgs.

## Requirements / gotchas

- The `000000` booking-OTP bypass must be enabled on the backend (temporary, test-only).
- Georgian is the default locale, so specs assert some Georgian strings and the
  delete-account confirm word (`წაშლა`).
