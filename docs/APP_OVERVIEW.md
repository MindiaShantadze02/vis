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
- **Edge Functions (Deno):** `request-booking-otp`, `verify-booking-otp`, `create-payment`, `payment-webhook`, `send-sms`, `request-password-reset`, `reset-password`, `delete-account`. (The legacy `get-available-slots` / `book-appointment` functions — never called by the client, and computing slots in UTC — were deleted 2026-07-08; their hosted deployments are 410 tombstones pending dashboard deletion.)
- **i18n:** Georgian (default), Russian, English via react-i18next; UI is Georgian-first. A language switcher is available on the public booking page, and the embed can pin a language via `?lang=`.
- **Auth:** **Phone + password** (Supabase Auth). Phone confirmation disabled via `sms_autoconfirm`, so signup returns a live session. Stored phone has no leading `+`. Sign-up requires a password of **≥10 characters** and consent to the Privacy Policy + Terms. *(In progress, uncommitted 2026-07-08:)* both `/login` and `/register` gain a **phone-OTP second step** (shared `OtpStep.tsx`, reusing `request-booking-otp`/`verify-booking-otp`) so phone ownership is proven before a session is issued / an account is created.
- **Timezone:** all customer-facing booking logic is pinned to **business time (Georgia, fixed `+04:00`)** via helpers in `client/src/lib/slots.ts` (`businessDayWindow`, `businessDayKey`, `toBusinessWallClock`, …) so slots don't shift with the viewer's browser zone. The admin dashboard intentionally stays viewer-local.
- **Testing:** **Playwright** e2e (`client/e2e/*.spec.ts`, 14 spec files / 49 tests; run `cd client && npx playwright test`) against the hosted project via the dev server; booking OTP master code `000000`. Plus a **Vitest unit layer** (`cd client && npm run test`, ~118 tests) for pure logic — `validation.ts`, `slug.ts`, `tiers.ts`, `slots.ts` (the slots suite runs under foreign TZs to prove viewer-zone independence). (Cypress was removed.)
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
- Available on **all tiers** (a Pro-only gate was considered and reversed 2026-07-04); the embed
  snippet lives in **Settings → Booking page** next to the booking link.

### Reviews (verified, appointment-bound) — migration 068
- Each **completed** appointment's UUID doubles as a capability link `/review/:appointmentId`
  (`pages/review/ReviewPage.tsx`) — only a real attendee can review, **one review per appointment**
  (UNIQUE on `appointment_id`). V1 delivery: the owner copies the review link from a completed
  appointment on the dashboard (auto-SMS invites are a later upgrade).
- Owner control is a single on/off toggle `organisations.reviews_enabled` (no per-review
  hide/delete — keeps ratings un-gameable). Lives in Settings → Booking page.
- The public booking page (and embed) shows **only the aggregate rating** (avg ★ + count, via
  `get_public_org`) in the branded sidebar — deliberately no per-review list. RPCs:
  `submit_review`, `get_review_context`, `get_public_reviews` (the last is unused by the public
  page, reserved for a future owner dashboard).

### Admin dashboard
- **Overview** — stats + revenue totals; copy-review-link on completed appointments.
- **Weekly calendar** — view/manage bookings, add manually, approve/reject/cancel pending.
- **Realtime in-app notifications** (owner bell) for new bookings.
- **Settings** (regrouped 2026-07-04 by concern, `SETTINGS_GROUPS` in `DashboardLayout.tsx`):
  - **Business:** Business info (name/description/contact phone/logo — path kept at
    `/settings/profile`), Services, Working hours, Team (invite members / add non-login
    professionals).
  - **Booking page:** everything customers see — shareable link + embed snippet, color theme
    (5 presets **or a custom brand hex**), reviews toggle.
  - **Billing:** Payment credentials, Subscription.
  - **Account:** delete-account danger zone.
- **Erase client data** action on an appointment (anonymizes the client's PII — Art. 16).
- **Visual theme** (2026-07-04): admin restyled calm/mature via `theme/theme.ts` — flat hairline
  cards, neutral background, muted terracotta accent. The public booking flow is exempt:
  `makeBookingTheme` re-pins the older lifted/citrus card+button look for `/book/*` and
  `/review/*`.

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
- `reviews` (one per appointment; org-scoped read; public aggregate exposed via `get_public_org`)
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
- Second audit pass shipped in migration `069_appointment_insert_hardening.sql` (2026-07-08): a
  BEFORE INSERT trigger (`normalize_guest_appointment`) pins untrusted guest inserts to
  `status=pending` / `payment_status=unpaid` / `payment_method=in_person` and nulls
  provider/reference/admin_notes — blocking self-approve, self-mark-paid, and review-bombing via
  fabricated `completed` rows. Service role (payment-webhook), superadmins and members of the
  target org are exempt. Same pass fixed `reset-password` (v6: OTP attempt budget summed across
  live challenges) and `payment-webhook` (v9: amount/currency validated against the stored intent
  for real providers).
- **OTP / SMS-pumping rate limits** (migration `070_otp_rate_limits.sql`, 2026-07-08): both
  code-sending endpoints (`request-booking-otp`, `request-password-reset`) record the caller IP
  and consult `check_otp_rate_limit` before issuing — per-IP burst + daily caps, a per-phone daily
  cap, and a platform-wide daily circuit-breaker, counted across both verification tables. Limits
  are superadmin-tunable in `platform_config.otp_rate_limits` (production defaults: 5/10min and
  20/day per IP, 6/day per phone, 1000/day global). Blocked booking requests return
  `too_many_requests` (surfaced in the UI); password-reset stays neutral (`ok: true`).
- Public reads go through SECURITY DEFINER RPCs that strip secrets: `get_public_org`,
  `get_booking_confirmation`, `get_org_busy_slots`.
- Storage buckets (`logos`, `member-photos`) are folder-scoped per org.

## Build status

**Built & live** (migrations through `070` on `dnmecnpugjxkjonqsfxx`): appointments end-to-end
(onboarding → settings → public booking with OTP → owner notification → dashboard approval); phone
auth; OTP password reset; online-payment plumbing via `create-payment`/`payment-webhook`; metering;
themed booking pages incl. custom brand color; embeddable widget (all tiers); verified reviews with
public aggregate rating; business-timezone (+04:00) slot logic; regrouped settings IA + admin theme
refresh; data-protection compliance (privacy/terms/consent/retention/erasure); RLS tenant-isolation
hardening (066) + guest-insert normalization and edge-function fixes (069).

**In progress (uncommitted):** phone-OTP verification step on `/login` and `/register`
(`OtpStep.tsx` + reworked auth pages + e2e updates).

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
- `platform_config.otp_rate_limits` is set to **relaxed test values** on the hosted project (the
  e2e suite re-requests codes for the same phones/IP constantly). At launch, restore production
  caps: `UPDATE platform_config SET otp_rate_limits = DEFAULT WHERE id = 1;`
- The tombstoned `get-available-slots` / `book-appointment` deployments should be deleted from the
  Supabase dashboard (the management MCP can't delete functions).
