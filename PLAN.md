# Vis Multi-Vertical Implementation Plan (Appointments · Restaurants · Hotels)

> **No feature code is written yet** — this is the reviewable plan.

## Context

Vis is a live, multi-tenant appointment-booking SaaS for the
Georgian market. The goal is to extend it to three booking **verticals** under one
codebase — **appointments** (current product), **restaurant table reservations**,
and **hotel room bookings** — under two non-negotiable constraints:

- **Constraint A — Vertical isolation:** a business picks one vertical and from then
  on sees *only* that vertical's terminology, settings, and screens. Vis must
  *feel* purpose-built per vertical.
- **Constraint B — Protect the working product:** the live appointment flow must keep
  working. Every change is additive, behind a vertical/feature flag, and the existing
  `appointments` table is never reshaped.

**Decisions confirmed with the owner (2026-06-29):**
1. **Data model:** shared core + per-vertical detail tables (not polymorphic, not fully separate stacks).
2. **Vertical is immutable** after onboarding (set once at signup, locked).
3. **Test investment:** author a regression suite *first* (before any vertical code), run manually via `npm run test:e2e`. **No CI/CD pipeline** — not worth the setup cost right now.

---

## 1. Codebase Audit Findings

### 1.1 Stack & conventions
- **Frontend:** React 19 + TS, Vite, React Router v7, MUI v9, i18next (ka/ru/en), Framer Motion. No Tailwind, **no React Query** — data access is direct `supabase.*` calls with `useState`/`useEffect` (e.g. `client/src/contexts/OrgContext.tsx:37`).
- **Backend:** Supabase (Postgres + PostgREST + Auth + Realtime + Edge Functions + Storage). Heavy RLS. Logic in SQL RPCs/triggers and Deno edge functions.
- **Migrations:** append-only `supabase/migrations/NNN_name.sql`, currently `001`–`043`. New work = new numbered files. **This is the safe additive path.**
- **Tests:** Cypress E2E only — 15 specs / 116 tests / ~1,672 LOC, fully mocked Supabase (`client/cypress/support/supabase-mock.ts`, `factories.ts`). **No CI** (`.github/` absent), **no unit/DB/edge-function tests**.

### 1.2 The "appointment shape" is hardcoded in exactly one place
`supabase/migrations/001_tables.sql:140-162` — the `appointments` table:
- `scheduled_at timestamptz NOT NULL` — **single start instant**, no end/range.
- `duration_minutes int2 NOT NULL` — **fixed**, snapshotted from the service.
- `customer_id uuid NOT NULL` — **one party**, no `party_size`/attendee list.
- `service_id uuid NOT NULL` — **one service** per booking.
- `staff_id uuid` (added `005_staff_and_capacity.sql:66`) — **optional single** resource; `NULL` = "any available".
- Capacity is **per-service** (`services.max_per_slot`, `005_staff_and_capacity.sql:21`), **not per-resource**. Two barbers offering the same service with `max_per_slot=1` still yield only 1 concurrent booking.

Surrounding machinery that assumes this shape (all bug-risk surfaces for any reshape):
- Triggers: `enforce_booking_verification` (`030`), `enforce_booking_advance_window` (`025`), `enforce_appointment_limit` (`028`), `notify_new_appointment` (`021`), `send_appointment_sms` (`029`), `appointments_updated_at` (`002`).
- Crons: `dispatch_appointment_reminders` (24h-before, `039`) and auto-complete (`023`) — both assume short single-slot bookings (meaningless for a 3-night hotel stay).
- Online flow: `pending_bookings` (`033`) mirrors the same columns; `payment-webhook` promotes it into `appointments`.

### 1.3 What already generalizes (reuse, don't rebuild)
- **`organisations`** (`001:17`) — tenant; generic. **No `vertical`/`business_type` column today** — only `subscription_tier`. Clean insertion point.
- **`customers`** (`001:54`) — phone-based guest, vertical-agnostic.
- **`working_hours_template` / `_overrides`** (`001:101`,`:122`) — org-scoped weekly schedule + per-date exceptions. JSONB ranges are flexible; reusable for restaurant service windows and hotel "reception open" hours.
- **`org_members` + `service_staff`** (`005`) — people/resources with per-service mapping. Note: `service_staff` is **UX-only, not DB-enforced** — useful precedent for a generic "resource ↔ offering" mapping.
- **Multi-tenancy/RLS core** — `get_user_org_ids()`, `get_user_org_role()`, `is_superadmin()` (`002`), and the `org_id = ANY(get_user_org_ids())` convention (`004_rls.sql`). **Reuse verbatim** for every new table.
- **Payments** — pluggable `PaymentProvider` interface (`supabase/functions/_shared/payments/types.ts`), provider resolution by env → `platform_config.payment_provider` → `mock` (`_shared/payments/index.ts:20`). Two flows (customer→business appointment; business→Vis subscription) share one webhook. **Server recomputes price; never trusts client** (`create-payment/index.ts`). Already idempotent. BOG/TBC are scaffolded stubs.

### 1.4 UI/onboarding structure & gating
- Routing in `client/src/App.tsx`: public `/book/:slug`, `/dashboard/*` (guards `AuthGuard`/`OrgGuard`/`SuperAdminGuard`/`PublicOnlyGuard`), `/onboarding/*`.
- Public booking = 3 hardcoded steps under `client/src/pages/book/`: `Step1ServiceSelect` → `Step2DateTimeSelect` → `Step3CustomerForm`, orchestrated by `BookingLayout.tsx` with a `BookingState` (`BookingLayout.tsx:61`) persisted to `sessionStorage`. Tightly coupled to "service + staff + time slot".
- Dashboard nav is a **static array** `NAV_ITEMS`/`SETTINGS_ITEMS` in `DashboardLayout.tsx:41` — easy to make vertical-conditional.
- Onboarding is a 3-step stepper (`OnboardingLayout.tsx`) with `OnboardingData` context.
- **Gating today:** subscription limits enforced **server-side only** (triggers/RPC `org_can_accept_appointment`). **There is no client-side feature-flag or vertical gating layer at all.** This must be built — it's the backbone of Constraint A.
- **i18n** exists (`client/src/lib/i18n.ts`, JSON in `client/public/locales/{ka,ru,en}/translation.json`). Terminology ("service", "specialist", "appointment") is translatable but **not vertical-namespaced**. This is the lever for per-vertical terminology.

### 1.5 Test coverage (booking/availability/payments)
- Substantial E2E: `booking.cy.ts` (17 tests incl. capacity `max_per_slot`, slot race, limit rejection), `payments.cy.ts` (9, both flows + server-recompute), `settings-subscription.cy.ts` (BVA on 80% warning). All Supabase-mocked.
- **Gaps:** no CI, no backend/DB/edge-function tests, no no-show/refund logic.

---

## 2. Proposed Architecture

### 2.1 The vertical-scoping mechanism (the spine of Constraint A)

**(a) Tenant field.** Add `organisations.vertical text NOT NULL DEFAULT 'appointments' CHECK (vertical IN ('appointments','restaurant','hotel'))`. Default backfills every existing org as `appointments` (zero behavior change). Immutable: enforced by a trigger blocking `UPDATE` of `vertical` once set (per decision #2; a `SECURITY DEFINER` superadmin-only path can be added later if ever needed).

**(b) Backend config layer.** A single source of truth describing each vertical's capabilities, consumed by both edge functions and RLS-adjacent checks. Keep it in Postgres-readable form (a `vertical_config` seed or a constant in `_shared/`) so server logic can assert "this org's vertical permits X".

**(c) Frontend feature/vertical layer (new — none exists today).** A `client/src/lib/verticals/` module exporting, per vertical:
- `terminology` → i18n namespace keys (`booking.unit`, `booking.resource`, `nav.bookings`…), so "Service/Specialist/Appointment" becomes "Table/—/Reservation" or "Room/—/Stay" without touching components.
- `nav` → which `DashboardLayout` items to show.
- `features` → booleans (`hasStaff`, `hasPartySize`, `hasDateRange`, `hasDeposits`…).
- `bookingFlow` → which step components to mount.

Exposed via `OrgContext` (extend the `Organisation` interface to carry `vertical`) and a `useVertical()` hook. **A restaurant owner's `OrgContext.vertical='restaurant'` drives every conditional** — nav, terminology, onboarding, booking flow — so hotel/appointment concepts are never rendered.

### 2.2 Shared core + per-vertical tables (decision #1)

```
organisations  (+ vertical)            ← unchanged otherwise
customers                              ← reused as-is across verticals
working_hours_template / _overrides    ← reused (service windows / reception hours)
org_members                            ← reused; doubles as staff/resource identity

── Appointments (UNCHANGED) ──
appointments, services, service_staff  ← live tables, never reshaped

── Resource core (new, thin) ──
resources(id, org_id, kind, name, capacity, attrs jsonb, sort_order, is_active)
   kind ∈ ('staff','table','room_type')   -- generic bookable inventory
   -- staff stays in org_members; 'table'/'room_type' rows live here

── Restaurant (new) ──
restaurant_reservations(
  id, org_id, customer_id, resource_id→table, party_size,
  reserved_at timestamptz, turn_minutes, status, deposit fields…, notes)

── Hotel (new) ──
hotel_stays(
  id, org_id, customer_id, room_type_id→resource,
  check_in date, check_out date,           -- DATE RANGE, the key departure
  guests, nightly_rate numeric, total_amount, status, notes)
hotel_inventory_calendar(room_type_id, date, rooms_available)  -- per-night availability
```

**Why this shape (Constraint B justification):**
- The live `appointments` table, its triggers, crons, RLS, and the entire current booking/payment path are **physically untouched** → near-zero regression risk for the live product.
- Hotels' date-range model lives in its own table with native `date` columns and a per-night calendar — **no contortion** of `scheduled_at`/`duration_minutes`, no lossy "nights×1440" encoding.
- Restaurants get structured `party_size`/`table` capacity matching instead of overloading `staff_id`.
- Shared concerns (tenant, customer, hours, RLS, payments) are reused, so we don't triple maintenance the way fully-separate stacks would.

**Per-vertical availability** (kept in separate code paths, mirroring `get_available_slots` patterns but isolated):
- Appointments: unchanged (client-side slot calc + `services.max_per_slot`).
- Restaurant: party-size → table-capacity matching, covers/turn-time per slot, walk-ins as same-day in-person inserts, no-show status.
- Hotel: range-overlap against `hotel_inventory_calendar`, nightly pricing sum, optional overbooking allowance per room_type, check-in/check-out as status transitions (the existing `pending→approved→completed` enum already fits).

### 2.3 Migration strategy (no existing appointment row is touched)
- Each step is its own `NNN_*.sql` appended after `043`.
- Only `ALTER TABLE organisations ADD COLUMN vertical … DEFAULT 'appointments'` (additive, backfills safely) plus `CREATE TABLE`/`CREATE POLICY` for new tables. **No `ALTER` of `appointments`, no `DROP`.**
- Every new table gets RLS mirroring the existing convention: public read where the booking page needs it (UUID-scoped), `org_id = ANY(get_user_org_ids())` for writes, superadmin for audit.
- New per-night/capacity uniqueness via `EXCLUDE`/unique constraints to prevent double-booking at the DB level (defense in depth, like the appointment capacity guard).

### 2.4 Payments (in mind, not redesigned)
Reuse the `PaymentProvider` abstraction and webhook unchanged. Note vertical implications for a **later** phase (flagged in §7):
- Restaurant **deposits** for no-show-prone slots → extend `CreateCheckoutParams` with an amount-type (full vs deposit); add deposit/refund columns on `restaurant_reservations`.
- Hotel **multi-night prepay / card hold** → `hotel_stays.total_amount` drives a single prepay; cancellation-window refund policy per room_type.
- Per-purpose mirrors the existing `pending_bookings` "intent → webhook promotes to real row" pattern: add `pending_reservations` / `pending_stays` analogues only when online payment is enabled for that vertical. Vis's own subscription revenue path is untouched and stays separate.

---

## 3. Onboarding / UI Approach (Constraint A)

1. **Vertical pick is step 0 of onboarding.** Before the business-profile step, a one-time chooser (Appointments / Restaurant / Hotel) sets `organisations.vertical`. After this, **all** subsequent onboarding steps, dashboard nav, terminology, and the public booking page are driven by `useVertical()`.
2. **Terminology via i18n namespaces.** Add `locales/*/restaurant.json` and `locales/*/hotel.json` (and an `appointments` namespace) so the same component renders "Reservation/Table" or "Stay/Room" with no per-vertical JSX forks for copy.
3. **Conditional nav & settings.** Make `NAV_ITEMS`/`SETTINGS_ITEMS` in `DashboardLayout.tsx` a function of `vertical`. Restaurants see "Tables/Floor plan", hotels see "Rooms/Rates/Calendar"; neither sees the others' settings. Appointments nav is unchanged for existing orgs.
4. **Vertical-routed booking flow.** `BookingLayout` picks the step set by `vertical`: appointments keep `Step1/2/3` as-is; restaurant = party-size + date/time + table; hotel = date-range + room-type + guest. Shared scaffolding (sessionStorage persistence, OTP, confirmation) is reused.
5. **Net effect:** a restaurant owner never sees a hotel or generic-appointment concept anywhere — the app *is* a restaurant app to them.

---

## 4. Phased Rollout (smallest safe, shippable, reversible increments)

**Phase 0 — Regression guardrails (decision #3; no product change).**
Author regression specs that pin the current appointment booking/availability/payment behavior, run manually via `npm run test:e2e`. Add a thin DB/edge-function test path for the critical triggers (capacity, advance-window, limit) and payment webhook idempotency. *Reversible: pure additions.* Ships first so every later phase has a safety net. (No CI pipeline — run the suite locally before each merge.)

**Phase 1 — Core abstraction & `vertical` field (no behavior change).**
Add `organisations.vertical` (default `appointments`, immutable trigger). Build the frontend `verticals/` config layer + `useVertical()`, extend `OrgContext`. Wire nav/terminology to default to today's appointment strings. Introduce the (empty) `resources` core table. **Verification: existing app behaves identically; all Phase 0 regression tests stay green.** *Reversible: flag-gated, default path unchanged.*

**Phase 2 — Restaurants (first new vertical; closest to current model).**
`restaurant_reservations` + table `resources` + party-size→table matching + covers/turn-time availability + walk-in + no-show status. Vertical-scoped onboarding, nav, booking flow, dashboard. New regression + restaurant E2E specs. Online deposits deferred (see §7). *Reversible: only reachable when `vertical='restaurant'`.*

**Phase 3 — Hotels (largest leap; last).**
`hotel_stays` (date ranges) + `hotel_inventory_calendar` + room-type inventory + range-overlap availability + nightly pricing + check-in/out + optional overbooking. Hotel onboarding/nav/flow/dashboard. Hotel-specific tests including range-overlap and double-book prevention. *Reversible: gated to `vertical='hotel'`.*

Each phase is independently shippable, gated by `vertical`, and leaves the live appointment product untouched.

---

## 5. Test Strategy

- **Discipline (no CI):** run `npm run test:e2e` locally and require it green before every merge — the suite is the safety net, just manually enforced.
- **Regression (the Constraint B proof):** lock the current appointment flow — service select, availability/capacity (`max_per_slot`), slot race, OTP gate, both payment flows, subscription limit/80% warning. These must stay green through every phase; a red here = a regression in the live product. Extend `factories.ts`/`supabase-mock.ts` with a `vertical` field defaulting to `appointments` so existing specs are unaffected.
- **Per-phase additions (write before building the phase):**
  - Phase 1: `vertical` defaulting/immutability; `useVertical()` renders appointment terminology by default; nav unchanged for existing orgs.
  - Phase 2: party-size→table matching, covers/turn-time capacity, walk-in insert, no-show, restaurant isolation (no appointment/hotel UI leaks).
  - Phase 3: range availability, per-night inventory decrement, **double-booking prevention** (DB constraint + concurrent-booking test), nightly price sum, check-in/out transitions.
- **Backend tests (new):** trigger behavior (capacity/advance/limit), RLS scoping per new table, payment webhook idempotency.

---

## 6. Risk Register (ranked)

1. **Regression in the live appointment flow.** *Mitigation:* `appointments` never altered; everything additive/flag-gated; Phase 0 regression suite authored before any vertical code and run (manually) green before every merge.
2. **Vertical isolation leaks** (a restaurant sees hotel/appointment UI). *Mitigation:* single `useVertical()` source of truth; nav/terminology/flow all derive from it; explicit isolation E2E assertions per vertical.
3. **Hotel double-booking / availability bugs** (range overlap is subtle). *Mitigation:* DB-level exclusion/unique constraint on room_type×date as the hard guard; per-night calendar; concurrent-booking tests; treat as Phase 3 (last, most scrutiny).
4. **RLS gaps on new tables** exposing cross-tenant data. *Mitigation:* copy the proven `org_id = ANY(get_user_org_ids())` convention; superadmin-only on audit tables; add RLS tests.
5. **Shared availability code drift** breaking appointments when refactored for reuse. *Mitigation:* keep per-vertical availability in **separate** code paths rather than over-generalizing one function; appointments path stays byte-for-byte until proven safe.
6. **Payment promotion races** (intent→real row) replicated imperfectly per vertical. *Mitigation:* reuse the existing idempotent `pending_bookings`→webhook pattern; add per-vertical idempotency tests; defer online deposit/prepay until the base vertical flow is solid.
7. **i18n/terminology gaps** (untranslated vertical strings fall back to appointment wording, breaking the illusion). *Mitigation:* per-vertical namespaces + a lint/test asserting key parity across namespaces.

---

## 7. Open Questions (for you, before coding)

1. **Restaurant capacity semantics:** match party size to a specific table, or just track total covers per slot against a capacity ceiling (simpler, no table identity)? Affects whether `resources(kind='table')` needs per-table attributes now.
2. **Hotel inventory granularity:** book by **room type** (N identical rooms, recommended/simpler) or by **individual room** (room 204)? Drives whether `hotel_inventory_calendar` is per-type or per-room.
3. **Overbooking:** do hotels need an overbooking allowance per room type, or strict no-overbook? Changes the availability constraint.
4. **Deposits/prepay scope for this plan:** confirm we **defer** restaurant deposits and hotel prepay/card-hold to a follow-up after each vertical's base flow ships (recommended), vs. building them inside Phase 2/3.
5. **Turn time & walk-ins (restaurant):** fixed turn time per slot, or per-party-size? Are walk-ins in scope for Phase 2 or later?
6. **Cancellation/refund policy:** any vertical-specific cancellation windows you want modeled now (e.g. hotel non-refundable < 14 days)? `payment_status` is binary today (`unpaid/paid/refunded`) — partial refunds would need new columns.
7. **Vertical availability reuse:** OK to keep three separate availability code paths (lowest regression risk) rather than one generalized engine? Recommended, but it does mean some duplicated logic.

---

## Verification (how we'll prove each step)

- **Regression gate:** `npm run test:e2e` (Cypress) run locally and green after every phase; the appointment regression specs are the canary for Constraint B.
- **Phase 1 no-op proof:** diff app behavior for an existing `appointments` org before/after — identical nav, booking, payments.
- **Per-vertical E2E:** drive each new booking flow end-to-end against the mocked Supabase layer; assert isolation (no foreign-vertical strings/nav present).
- **DB safety:** migration applied on a copy via `supabase db push`; verify `migration list` has no drift; confirm new RLS denies cross-tenant reads and DB constraints reject double-bookings.
