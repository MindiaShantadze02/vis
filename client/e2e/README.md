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

### Optional: `SUPABASE_SERVICE_ROLE_KEY`

Three billing tests need to put the seed org into `past_due` / `suspended`, which
no client credential can do — `prevent_billing_self_update` rejects owners (the
first billing test asserts exactly that). Add the project's service-role key to
`client/.env` (gitignored; **no** `VITE_` prefix, so Vite never bundles it into
the browser) and they run:

```
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Without it they **skip**. Prefer running them: the unpaid-org booking leak fixed
in `20260816120000` survived precisely because this path was never exercised.
Each test restores `billing_status = 'active'` in a `finally`, so an interrupted
run does not leave the seed org blocked — if one ever does, reset it with the
same key.

Do not reach for this key for anything else. Every other spec goes through the
owner's own credentials on purpose; using the service role elsewhere would stop
the suite proving that RLS works.

## What's covered

Happy paths + edge cases (validation gating, route guards, error states):

| Spec | Flows | Edge cases |
|------|-------|-----------|
| `auth.spec.ts` | login, logout, phone signup → onboarding | bad password, unknown phone, duplicate-phone signup, mismatch/invalid-phone gating, protected-route redirect, logged-in `/login` redirect, forgot-password gating |
| `onboarding.spec.ts` | full 3-step onboarding → org (self-cleans) | step-1 "next" gating, a typed-but-not-added service is kept on Next, skip → dashboard, org-guard bounce |
| `booking.spec.ts` | public in-person booking + OTP → auto-approved confirmation (075 default) | unknown slug, invalid name/phone gating, **wrong OTP rejected** |
| `dashboard.spec.ts` | overview stats + link, clients list, calendar nav | no manual add-appointment action (bookings come from the public flow only) |
| `billing.spec.ts` | billing guard + RLS (owner can read invoices, cannot set `billing_status` or write the ledger), add a card without being charged; **unpaid-org blocking** — `past_due`/`suspended` refuse bookings server-side (`org_can_accept_appointment` + `create-payment`) and raise the non-dismissable owner modal | the last three need `SUPABASE_SERVICE_ROLE_KEY` (see Run) and skip without it; each restores `active` in a `finally` |
| `settings-services.spec.ts` | service create → edit → delete (self-cleans) | save gating (empty name / out-of-range price / bad duration); **BVA** on duration/capacity/price |
| `meeting-link.spec.ts` | per-appointment online link: owner pastes a link on an online-service appointment and sends it via SMS (seeds an approved online appt over PostgREST; cancels + deactivates in teardown) | invalid-link inline flag, "link needed" cue clears + link round-trips through `search_appointments` |
| `settings-team.spec.ts` | add/delete professional; invite by phone + cancel (self-clean) | invite-send gating, add-professional name gating |
| `appointment-status.spec.ts` | **state-transition** of the status machine (approved→cancelled, approved→no_show) | terminal-state guardrails, status-filter **ECP** — self-cleans (cancel + erase) |
| `calendar.spec.ts` | locate a booking on the week grid and open its detail drawer | resilient pill/group locate, no approval actions offered — self-cleans |
| `forgot-password.spec.ts` | phase transition (`phone`→`reset`), neutral messaging | wrong-code rejected, resend cooldown, submit-gating **BVA** (throwaway phone — never touches the seed password) |
| `working-hours.spec.ts` | override add → delete (self-clean state cycle) | **decision** (endBeforeStart) + **BVA** (advance days 0/731) rejects — non-persisting |
| `profile-settings.spec.ts` | Business settings — | name/phone save-gating, logo image **BVA** (>2 MB / non-image) |
| `booking-settings.spec.ts` | Booking-page settings — share link/embed + preview link | custom booking colour, reviews toggle switchable (non-persisting) |
| `account-settings.spec.ts` | Account settings — | delete-account confirm-word guard (never confirmed) |
| `superadmin.spec.ts` | — | role **ECP**: a normal owner is redirected off `/superadmin` and its sub-routes |

### Design techniques applied

- **ECP / BVA / statement / decision / path / data-flow** — the bulk lives in the
  Vitest unit layer (`src/lib/*.test.ts`, run with `npm run test`): 100% stmt/branch
  on `validation.ts` and `slug.ts`. Boundary cases too numerous or slow to
  drive through the live UI (every phone length, price/duration/advance-day edge, the
  60-char slug cut, the 2 MB image edge) live there.
- **State-transition** — appointment status machine, forgot-password phases.
- **Pairwise** — booking Step-3 field combinations.
- **Error-guessing** — catalogued below.

### Error-guessing catalogue

Cases seeded from experience of where this app tends to break:

- Booking: name with digits, whitespace-only name, `<script>` injection, `+995`-pasted
  phone (must normalize & pass), consent unticked, **wrong OTP**.
- Forgot-password: wrong 6-digit code, resend within the 60 s cooldown, unknown phone
  must NOT leak account existence (neutral messaging).
- Services/working-hours: over-`MAX_PRICE` price, duration `0`/`1441`, capacity `0`,
  advance-days `0`/`731`, day closing before it opens.
- Profile: image just over 2 MB, non-image upload, delete-account confirm word.
- Superadmin: a non-superadmin reaching a privileged route.

## Test data & the seeded account

Authenticated specs log in as the seeded owner in `helpers.ts` (`SEED`):
`555108509` / `password123`, org **Test Appointments Studio**
(`/book/test-appointments-studio`, service "Consultation"). Keep that account and
its active service + Mon–Fri hours intact, or the booking/dashboard specs will fail.

## What persists (not self-cleaned)

- **`booking.spec.ts`** creates a real appointment (auto-approved since 075) +
  customer on the seeded org each successful run (a guest can't self-delete).
  Cancel/prune them from the dashboard periodically.
- The pending-approval workflow is **gone** (2026-08-14): every appointment is
  created `approved` and `organisations.require_approval` was dropped.
  `appointment-status.spec.ts` / `calendar.spec.ts` insert their rows directly
  via `seedUpcomingAppointment` rather than paying through the public booking flow.
- Register-based tests (`auth` signup, `onboarding` "next"-gating and skip) each
  leave a throwaway auth user with **no org**. Only the full `onboarding` happy
  path self-deletes its account. Prune the rest with:
  `delete from auth.users u where u.created_at > now() - interval '1 hour'
   and not exists (select 1 from org_members m where m.user_id = u.id);`
- `appointment-status.spec.ts` and `calendar.spec.ts` each seed real appointments
  but **self-clean**: they cancel (so the row drops out of the billable count) and
  then erase the client's PII. The rows remain as anonymized/cancelled records.
  The `approved→no_show` case is terminal and stays billable by design.

## Not yet covered (follow-ups)

- **Superadmin privileged flows** (add/remove superadmin) need a superadmin test
  account — not provisioned here. `superadmin.spec.ts` covers only the access
  guard. Billing-status changes are no longer in this bucket: `billing.spec.ts`
  drives them with the service-role key instead of the superadmin UI.
- ~~Online-payment booking path~~ — now covered by `refund.spec.ts`, which
  temporarily enables `payment_config.bog.enabled` on the seed org to drive
  guest checkout → `/pay/mock` → `payment-webhook` → cancel-with-refund
  (`refund-payment`). Still NOT covered: the webhook's auto-refund on
  fulfilment failure (charge cleared but appointment creation failed) — forcing
  it needs a mid-checkout slot conflict; verify that path manually via
  payment_log (`status='refunded'` with the fulfilment error in `error`).
- **Embed postMessage bridge** and **invitation-accept** — need extra harness setup.

Because everything shares one hosted DB and one seeded account, the suite runs
**serially** (`workers: 1`). Don't switch it to parallel without per-worker orgs.

## Requirements / gotchas

- The `000000` booking-OTP bypass must be enabled on the backend (temporary, test-only).
- Georgian is the default locale, so specs assert some Georgian strings and the
  delete-account confirm word (`წაშლა`).
