# Vis — Multi-Vertical Booking SaaS

> Product name **Vis** (codename *Grafiki*). Hosted Supabase project ref `dnmecnpugjxkjonqsfxx`.

## What it is
A multi-tenant SaaS platform for the **Georgian market** that lets small businesses take online bookings. Each business gets a **public booking page** (`/book/[slug]`) to share on social media. End customers book as **guests** (no account — name + phone, verified by an SMS code). Owners manage everything through an admin dashboard.

The platform is **multi-vertical** — one codebase serves three business types, chosen at registration and locked to the org:

| Vertical | Books | "Catalog" unit | Booking model |
|----------|-------|----------------|---------------|
| **appointments** (original) | time slots for a service | `services` (duration + price) | service → date/time → details |
| **restaurant** | table reservations | `resources` (kind `table`) | party size → date/time → details |
| **hotel** | room-night stays | `resources` (kind `room_type`) | date range → room → details |

All three share the same shell, theming, OTP gate, notifications, metering, and dashboard; only the domain-specific steps differ.

## Tech stack
- **Frontend:** React 19 + TypeScript + Vite, MUI v9 + MUI X (DataGrid, Date Pickers), React Router v7, framer-motion
- **Backend:** Supabase only (Postgres + Auth + Edge Functions + Realtime + Storage) — **no separate Node server**
- **Edge Functions (Deno):** `request-booking-otp`, `verify-booking-otp`, `create-payment`, `payment-webhook`, `send-sms`, `request-password-reset`, `reset-password`, `delete-account`, `get-available-slots` / `book-appointment` (legacy, largely unused — booking inserts happen client-side under RLS)
- **i18n:** Georgian (default), Russian, English via react-i18next; UI is Georgian-first
- **Auth:** **Phone + password** (Supabase Auth). Phone confirmation disabled via `sms_autoconfirm`, so signup returns a live session. Stored phone has no leading `+`.
- **Testing:** Cypress (e2e) + Playwright (ad-hoc flows)
- **Currency:** Georgian Lari (₾)

## User roles
1. **Guest customer** — books publicly, no login; verifies phone via SMS OTP
2. **Business admin / org members** — manage their org (multi-admin via invitations; roles owner/member)
3. **Superadmin** — platform owner; manages all orgs, overrides tiers, views platform stats

## Core flows

### Registration & onboarding
- Ads deep-link to `/register/:vertical`; a bare `/register` shows a vertical picker. The chosen vertical is stored in auth metadata (`signup_vertical`) and seeds onboarding.
- **3-step onboarding wizard:** business profile → **vertical-specific catalog** (services *or* tables *or* room types) → working hours. The org row + members + catalog + weekly hours are all created at the final step. Users can skip onboarding to an empty dashboard.

### Public booking (guest, OTP-gated)
1. Vertical-specific selection steps (service / party+time / dates+room).
2. Customer details (name + phone, optional notes; payment method if online is enabled).
3. **Phone OTP:** `request-booking-otp` sends a code (via the SMS layer); `verify-booking-otp` checks it. A DB trigger (`enforce_booking_verification`) only lets the booking insert through once the phone is verified.
4. **Finish:**
   - *Pay in person / at desk:* row inserted directly with status `pending` (awaits owner approval).
   - *Pay online:* nothing is written yet — `create-payment` parks the intent and redirects to the gateway; `payment-webhook` creates the paid row only after the charge clears (so abandoned payments leave no orphan booking).
   - Appointments navigate to a dedicated `/booking-confirmation/:id` route; restaurant/hotel render an inline "done" ticket.

> **Test SMS code:** enter **`000000`** at the OTP step. This is a temporary hosted bypass (see below).

### Admin dashboard
- **Overview** — stats + revenue totals; vertical-aware (appointments / reservations / stays).
- **Weekly calendar** — view/manage bookings, add manually, approve/reject pending.
- **Realtime in-app notifications** (owner bell) for new bookings.
- **Settings:** profile, catalog (services/tables/rooms), working hours, team (invite members), payment credentials, subscription.

### Superadmin panel (`/superadmin`)
Platform overview, org list & detail, tier overrides, multi-superadmin management.

## Key domain model
- `organisations` (one per owner; carries `vertical`, `subscription_tier`, `reservation_turn_minutes`, `payment_config`)
- `org_members` + `invitations` (team)
- Catalog: `services` (appointments); `resources` with `kind` `table` / `room_type` (restaurant/hotel; nightly price & total rooms live in `attrs` jsonb)
- Bookings: `appointments`, `restaurant_reservations`, `hotel_stays`; shared `customers` (name + phone only)
- Verification: `booking_verifications` (hashed OTP challenges)
- Availability: `working_hours_template` (weekly recurring) + `working_hours_overrides` (per-date); **slots computed at query time** client-side, no pre-generated slots table
- Payments: pluggable providers in `_shared/payments/` (mock-first; BOG/TBC scaffolded), `pending_stays` for hotel prepay, payment columns on booking rows
- SMS: event-driven — a DB trigger enqueues, the `send-sms` edge function dispatches through a pluggable `SmsProvider` (`_shared/sms/`); currently a **mock** provider (logs only)
- **Multi-tenancy enforced via Postgres RLS** throughout; public reads go through the `get_public_org` SECURITY DEFINER RPC (strips secrets)
- **Subscription tiers:** Free (30/mo), Starter ₾15 (200/mo), Pro ₾40 (600/mo), Business ₾80 (unlimited). Limits in `platform_config.tier_limits` JSON (superadmin-editable, no deploy). **Unified metering:** appointments + reservations + stays all count toward the monthly limit, enforced via `org_can_accept_appointment` / `enforce_appointment_limit`.
- `pg_cron`: auto-complete past bookings; booking notifications & reminders
- Account deletion cascades all org data

## Build status

**Built & live** (migrations 044–053 on `dnmecnpugjxkjonqsfxx`): all three verticals end-to-end (onboarding → settings → public booking with OTP → owner notification → dashboard approval); phone auth; password reset (OTP-based); booking OTP; online-payment plumbing (appointment + hotel full prepay) via `create-payment`/`payment-webhook`; unified metering; configurable restaurant turn time; themed booking pages.

**Not built / not real yet:**
- **Real SMS delivery** — only a mock provider (codes are logged, not sent). No real gateway.
- **Real payment gateway** — BOG/TBC providers are scaffolded but run against a **mock** gateway; not production-wired. Subscription-billing checkout (upgrade button) is likewise not wired to a real charge.
- Appointment reminders delivery, customer self-service cancel/reschedule, CRM/customer directory, analytics, data export.

**⚠️ Temporary launch-blocking flags (must be undone before real launch — tracked in `docs/MULTI_VERTICAL_TODO.md`):**
- `ALLOW_TEST_OTP` + `ALLOW_TEST_OTP_HOSTED` → enables the `000000` OTP bypass on the **hosted** project (normally local-host only). Re-opens a hole the 2026-06-24 security review closed; remove when real SMS lands.
- `ALLOW_MOCK_PAYMENTS` → lets the unauthenticated `/pay/mock` webhook settle payments (needed to test hotel prepay). Remove and wire a real provider before launch.
