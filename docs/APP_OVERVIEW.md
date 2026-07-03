# Vis — Appointment Booking SaaS

> Product name **Vis** (codename *Grafiki*). Hosted Supabase project ref `dnmecnpugjxkjonqsfxx`.

## What it is
A multi-tenant SaaS platform for the **Georgian market** that lets small service businesses
(salons, spas, clinics, trainers, barbers, etc.) take online appointment bookings. Each business
gets a **public booking page** (`/book/[slug]`) to share on social media or **embed on its own
website**. End customers book as **guests** (no account — name + phone, verified by an SMS code).
Owners manage everything through an admin dashboard.

> **Appointments-only.** The app briefly explored restaurant and hotel verticals (migrations
> 044–058) but those were **fully removed** in migration `059_appointments_only.sql` (2026-07-02).
> There is one product: appointment booking. Ignore any lingering "multi-vertical" references in
> older docs.

## Tech stack
- **Frontend:** React 19 + TypeScript + Vite, MUI v9 + MUI X (DataGrid, Date Pickers), React Router v7, framer-motion
- **Backend:** Supabase only (Postgres + Auth + Edge Functions + Realtime + Storage) — **no separate Node server**
- **Edge Functions (Deno):** `request-booking-otp`, `verify-booking-otp`, `create-payment`, `payment-webhook`, `send-sms`, `request-password-reset`, `reset-password`, `delete-account`, `get-available-slots` / `book-appointment` (legacy, largely unused — booking inserts happen client-side under RLS)
- **i18n:** Georgian (default), Russian, English via react-i18next; UI is Georgian-first. A language switcher is available on the public booking page, and the embed can pin a language via `?lang=`.
- **Auth:** **Phone + password** (Supabase Auth). Phone confirmation disabled via `sms_autoconfirm`, so signup returns a live session. Stored phone has no leading `+`. Sign-up requires a password of **≥10 characters** and consent to the Privacy Policy + Terms.
- **Testing:** **Playwright** e2e (`client/e2e/*.spec.ts`, 27 specs; run `cd client && npx playwright test`). Runs against the hosted project via the dev server; booking OTP master code `000000`. (Cypress was removed.)
- **Hosting:** Vercel (SPA). `client/vercel.json` sets `frame-ancestors` so `/book/*` may be embedded anywhere while the dashboard/login are frame-blocked (clickjacking protection).
- **Currency:** Georgian Lari (₾)

## User roles
1. **Guest customer** — books publicly, no login; verifies phone via SMS OTP
2. **Business admin / org members** — manage their org (multi-admin via phone invitations; roles owner/admin/member; non-login `staff` profiles for bookable professionals)
3. **Superadmin** — platform owner; manages all orgs, overrides tiers, views platform stats

## Core flows

### Registration & onboarding
- Sign up with **phone + password** (tabbed on `/login`, or `/register`); consent checkbox required.
- **3-step onboarding wizard:** business profile → services (name, duration, price) → weekly working
  hours. The org row + owner membership + services + weekly hours are created at the final step.
  Users can skip onboarding to an empty dashboard.

### Public booking (guest, OTP-gated)
1. **Service** → **date/time** (with staff pick or "any available") → **customer details** (name +
   phone, optional notes, payment method if online is enabled, required Privacy/Terms consent).
2. **Phone OTP:** `request-booking-otp` sends a hashed code; `verify-booking-otp` checks it. A DB
   trigger (`enforce_booking_verification`) only lets the booking insert through once the phone is
   verified.
3. **Finish:**
   - *Pay in person:* row inserted directly with status `pending` (awaits owner approval).
   - *Pay online:* nothing is written yet — `create-payment` parks the intent in `pending_bookings`
     and redirects to the gateway; `payment-webhook` creates the paid row only after the charge
     clears (so abandoned payments leave no orphan booking).
   - Lands on `/booking-confirmation/:id` (data via the `get_booking_confirmation` RPC).
- Availability is read through the `get_org_busy_slots` SECURITY DEFINER RPC (org-scoped; anon has
  no direct read on `appointments`). Slots are computed client-side — no pre-generated slots table.

> **Test SMS code:** enter **`000000`** at the OTP step. Temporary hosted bypass (see flags below).

### Embeddable booking widget
- Any business can embed its form on its own website. Detection: `?embed=1` or `window.self !==
  window.top`. In embed mode the form renders **bare** (no business sidebar/branding — the host
  site provides it), on a clean background.
- `client/public/embed.js` (pasted by the business) auto-sizes the iframe via a `postMessage`
  bridge (`pages/book/useEmbedBridge.ts`) and breaks the payment redirect out to the top window.
- The dashboard Overview shows a copy-paste embed snippet next to the booking link.

### Admin dashboard
- **Overview** — stats + revenue totals; booking link + website-embed snippet.
- **Weekly calendar** — view/manage bookings, add manually, approve/reject/cancel pending.
- **Realtime in-app notifications** (owner bell) for new bookings.
- **Settings:** profile (incl. booking-page color — 5 presets **or a custom brand hex**), services,
  working hours, team (invite members / add non-login professionals), payment credentials,
  subscription.
- **Erase client data** action on an appointment (anonymizes the client's PII — Art. 16).

### Superadmin panel (`/superadmin`)
Platform overview, org list & detail, tier overrides, multi-superadmin management. All backing RPCs
gate on `is_superadmin()`.

## Data protection & privacy (Georgian Law on Personal Data Protection, No. 3144)
- **Privacy Policy + Terms** (canonical markdown in `docs/legal/`, in-app pages at `/privacy`,
  `/terms`, rendered from `pages/legal/legalContent.ts`; placeholders pending legal-entity details).
- **Consent** captured (with version) at booking and registration; stored on `customers` /
  `pending_bookings`.
- **Retention** (migrations 064/065): a daily `purge_expired_data()` pg_cron deletes stale
  verification codes, parked bookings and old SMS logs, and **anonymizes** appointments/customers
  past the window (kept for revenue/tax) — windows tunable in `platform_config.retention_config`.
- **Erasure**: `erase_customer_data(appointment_id)` RPC (org-scoped).

## Key domain model
- `organisations` (one per owner; `subscription_tier`, `payment_config`, `booking_theme` — preset
  key or custom `#RRGGBB`)
- `org_members` + `invitations` (team; phone-based invites; `staff` = non-login bookable profile)
- `services` (name, duration, price, `max_per_slot` capacity), `service_staff` (who performs what)
- `appointments` + shared `customers` (name + phone; consent fields; `anonymized_at`)
- Verification: `booking_verifications` / `password_reset_verifications` (hashed OTP challenges)
- Availability: `working_hours_template` (weekly) + `working_hours_overrides` (per-date)
- Payments: pluggable providers in `_shared/payments/` (mock-first; BOG/TBC scaffolded),
  `pending_bookings` for online-pay intents, payment columns on `appointments`
- SMS: event-driven — a DB trigger enqueues, the `send-sms` edge function dispatches through a
  pluggable `SmsProvider` (`_shared/sms/`); currently a **mock** provider
- **Subscription tiers:** Free (30/mo), Starter ₾15 (200/mo), Pro ₾40 (600/mo), Business ₾80
  (unlimited). Limits in `platform_config.tier_limits` JSON (superadmin-editable, no deploy);
  enforced via `org_can_accept_appointment` / `enforce_appointment_limit`.
- `pg_cron`: auto-complete past appointments; booking notifications & reminders; retention purge
- Account deletion cascades all org data (+ best-effort storage cleanup)

## Security & multi-tenancy
- **RLS everywhere.** Tenant-isolation hardening shipped in migration `066_security_hardening.sql`:
  a `prevent_role_escalation` trigger (no member self-promotion to owner), `organisations` SELECT
  scoped to own-org/superadmin (payment secrets no longer readable cross-tenant), and anon reads of
  `appointments` removed in favor of the org-scoped RPCs above.
- Public reads go through SECURITY DEFINER RPCs that strip secrets: `get_public_org`,
  `get_booking_confirmation`, `get_org_busy_slots`.
- Storage buckets (`logos`, `member-photos`) are folder-scoped per org.

## Build status

**Built & live** (migrations through `067` on `dnmecnpugjxkjonqsfxx`): appointments end-to-end
(onboarding → settings → public booking with OTP → owner notification → dashboard approval); phone
auth; OTP password reset; online-payment plumbing via `create-payment`/`payment-webhook`; metering;
themed booking pages incl. custom brand color; embeddable widget; data-protection compliance
(privacy/terms/consent/retention/erasure); RLS tenant-isolation hardening.

**Not built / not real yet:**
- **Real SMS delivery** — only a mock provider (codes are logged, not sent). No real gateway.
- **Real payment gateway** — BOG/TBC providers are scaffolded but run against a **mock** gateway;
  not production-wired. Subscription-billing checkout is likewise not wired to a real charge.
- Appointment-reminder delivery, customer self-service cancel/reschedule, CRM/customer directory,
  analytics, data export.
- Privacy Policy / Terms `[PLACEHOLDER]` fields (company name, ID, address, email) — fill once the
  legal entity is registered.

**⚠️ Temporary launch-blocking flags (must be undone before real launch):**
- `ALLOW_TEST_OTP` / `ALLOW_TEST_OTP_HOSTED` → enables the `000000` OTP bypass on the **hosted**
  project. Remove when real SMS lands.
- `ALLOW_MOCK_PAYMENTS` → lets the unauthenticated `/pay/mock` webhook settle payments. Remove and
  wire a real provider before launch.
