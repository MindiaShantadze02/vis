# Vis — Appointment Booking SaaS

> Product name **Vis**. Hosted Supabase project ref `dnmecnpugjxkjonqsfxx`.
> Migrations applied through `083_solo_team_tiers.sql` (2026-07-16).

## What it is
A multi-tenant SaaS platform for the **Georgian market** that lets small service businesses
(salons, spas, clinics, trainers, barbers, etc.) take online appointment bookings. Each business
gets a **public booking page** (`/book/[slug]`) to share on social media or **embed on its own
website**, plus a **public REST API** for custom integrations. End customers book as **guests**
(no account — name + phone, verified by an SMS code). Owners manage everything through an admin
dashboard. The product front door is a **marketing landing page** at `/` (features, pricing,
developer strip, footer links to docs and legal pages).

> **Appointments-only.** The app briefly explored restaurant and hotel verticals (migrations
> 044–058) but those were **fully removed** in migration `059_appointments_only.sql` (2026-07-02).
> There is one product: appointment booking. Ignore any lingering "multi-vertical" references in
> older docs.

## Tech stack
- **Frontend:** React 19 + TypeScript + Vite, MUI v9 + MUI X (DataGrid, Date Pickers), React Router v7, framer-motion, Phosphor icons
- **Backend:** Supabase only (Postgres + Auth + Edge Functions + Realtime + Storage) — **no separate Node server**
- **Edge Functions (Deno):** `api` (public REST API), `request-booking-otp`, `verify-booking-otp`, `create-payment`, `payment-webhook`, `send-sms`, `request-password-reset`, `reset-password`, `delete-account`. (Legacy `get-available-slots` / `book-appointment` were deleted 2026-07-08; their hosted deployments are 410 tombstones pending dashboard deletion.)
- **i18n:** Georgian (default/fallback), Russian, English via react-i18next (`localStorage['vis-lang']`).
  Language switchers on the landing page, dashboard, and the standalone public booking page; the
  embed can pin a language via `?lang=`. The public dev-docs pages carry all three languages
  inline; the legal pages exist in Georgian (legally authoritative) + English, and every other UI
  language falls back to **English** (not Georgian) there.
- **Auth:** **Phone + password** (Supabase Auth). Phone confirmation disabled via `sms_autoconfirm`,
  so signup returns a live session. Stored phone has no leading `+`. Both `/login` and `/register`
  include a **phone-OTP second step** (shared `OtpStep.tsx`, reusing
  `request-booking-otp`/`verify-booking-otp`) so phone ownership is proven before a session is
  issued / an account is created. Password minimum is **8 characters**; registration requires
  consent to the Privacy Policy + Terms.
- **Timezone:** all customer-facing booking logic is pinned to **business time (Georgia, fixed `+04:00`)** via helpers in `client/src/lib/slots.ts` (`businessDayWindow`, `businessDayKey`, `toBusinessWallClock`, …) so slots don't shift with the viewer's browser zone. The `api` edge function keeps a Deno copy of `slots.ts` that must stay in sync. The admin dashboard intentionally stays viewer-local.
- **Testing:**
  - **Playwright e2e** — 29 spec files / 68 tests (`cd client && npx playwright test`) against the
    hosted project via the dev server; booking OTP master code `000000`. Includes a **data-driven
    layer**: BVA/ECP rows live in `e2e/data/*.json`, executed by `e2e/data-driven/*.spec.ts`, with
    `consistency.spec.ts` guarding that data-file boundaries match the app's real limits.
  - **Vitest unit layer** — 5 files / 153 tests (`cd client && npm run test`) for pure logic:
    `validation.ts`, `slug.ts`, `tiers.ts`, `slots.ts` (the slots suite runs under foreign TZs to
    prove viewer-zone independence). (Cypress was removed.)
- **Validation UX conventions:** submit buttons are **never disabled for validation** — validate on
  click and show inline per-field errors (`aria-invalid`), scrolling to the first invalid field.
  Banners/toasts are reserved for server errors.
- **Hosting:** Vercel (SPA). `client/vercel.json` sets `frame-ancestors` so `/book/*` may be embedded anywhere while the dashboard/login are frame-blocked (clickjacking protection).
- **Currency:** Georgian Lari (₾)

## User roles
1. **Guest customer** — books publicly, no login; verifies phone via SMS OTP
2. **Business admin / org members** — manage their org (multi-admin via phone invitations; roles owner/admin/member; non-login `staff` profiles for bookable professionals)
3. **Superadmin** — platform owner; manages all orgs, overrides tiers, works the concierge-setup queue, views platform stats

## Core flows

### Registration & onboarding
- Sign up with **phone + password** (tabbed on `/login`, or `/register`) → **OTP verification
  step** → session. Consent checkbox required.
- **4-step onboarding wizard** (`/onboarding/business|services|specialists|hours`): business
  profile → services (name, duration, price, photos) → specialists (bookable staff, optional
  photos) → weekly working hours — with a **live booking-page preview** alongside the steps. The
  org row + owner membership + services + staff + weekly hours are created at the final step.
  Users can skip onboarding to an empty dashboard.
- **Concierge onboarding** (migration 078): a business that doesn't want to self-serve submits a
  "set it up for me" request (`/onboarding/help` → `setup_requests`, one open request per org,
  phone snapshotted server-side). Superadmins work the queue and configure services/staff/hours
  **on the owner's behalf**; marking it completed texts the requester (`setup_complete` SMS).

### Public booking (guest, OTP-gated)
1. **Service** (with per-service **photo galleries**, migration 074 — shown in the form and in the
   branded sidebar after the service-select step) → **date/time** (staff pick or "any available")
   → **customer details** (name + phone, optional notes, payment method if online payment is
   enabled, required Privacy/Terms consent).
2. **Phone OTP:** `request-booking-otp` sends a hashed code; `verify-booking-otp` checks it. A DB
   trigger (`enforce_booking_verification`) only lets the booking insert through once the phone is
   verified.
3. **Finish:**
   - *Pay in person:* row inserted directly (client-side; the old `book-appointment` edge function
     is gone). Status is **derived server-side** from the org's `require_approval` flag
     (migrations 075/080): **new orgs default to manual approval** (`pending` until the business
     approves); a business can opt into auto-approve (`approved` immediately) from Settings →
     Booking page.
   - *Pay online:* nothing is written yet — `create-payment` parks the intent in `pending_bookings`
     and redirects to the gateway; `payment-webhook` creates the paid row only after the charge
     clears (so abandoned payments leave no orphan booking).
   - Lands on `/booking-confirmation/:id` (data via the `get_booking_confirmation` RPC).
- The confirmation/approval SMS includes the business's **street address** when set
  (`organisations.address`, migration 077).
- **Online services:** the meeting link is **per-appointment**, not per-service (migration 082 —
  `appointments.meeting_link`; `services.meeting_link` is dead). The owner attaches a link to an
  online appointment on the dashboard and sends it by SMS via the `request_meeting_link_sms` RPC —
  decoupled from approval, so the link can be sent or re-sent at any time.
- Availability is read through the `get_org_busy_slots` SECURITY DEFINER RPC (org-scoped; anon has
  no direct read on `appointments`). Slots are computed client-side — no pre-generated slots table.

> **Test SMS code:** enter **`000000`** at the OTP step. Temporary hosted bypass (see flags below).

### Embeddable booking widget
- Any business can embed its form on its own website. Detection: `?embed=1` or `window.self !==
  window.top`. In embed mode the form renders **bare** (no business sidebar/branding — the host
  site provides it), on a clean background; `?lang=ka|en|ru` pins the widget language.
- `client/public/embed.js` (pasted by the business) auto-sizes every `iframe[data-vis]` via a
  `postMessage` bridge (`pages/book/useEmbedBridge.ts`), accepts messages only from the iframe's
  own origin, and breaks the payment redirect out to the top window. A completed booking
  dispatches a **`vis:booked` DOM event** on the iframe element for host-page analytics.
- Available on **all tiers** (a Pro-only gate was considered and reversed 2026-07-04); the embed
  snippet lives in **Settings → Booking page** next to the booking link.
- Public docs: `/docs/widget` (trilingual, no auth).

### Public REST API (v1) — migration 071 + `api` edge function
- Custom integrations without the widget: **per-organisation API keys** (`grf_…`, up to 5 active
  per org, minted/revoked in **Settings → API keys**; revocation immediate), passed via
  `x-api-key` or `Authorization: Bearer`.
- Endpoints: `GET /v1/organisation`, `GET /v1/services`, `GET /v1/slots` (same availability rules
  as the booking page), `POST /v1/bookings` (creates an in-person booking; `status` may be
  `pending` or `approved`; the requested time is re-validated server-side just before insert —
  race returns 409).
- **No customer OTP on this path** — the API key is the trusted credential; the caller vouches for
  customer consent (timestamp/version recorded). The OTP exemption is a GUC **inside
  `api_create_booking`** — deliberately *not* a service-role exemption.
- **Rate limit:** 60 requests/key/minute (HTTP 429), tunable in `platform_config.api_rate_limits`.
  Bookings count against the plan's monthly quota (403 when full).
- Uniform error shape `{ "error": "<code>", "message": "…" }`. Docs: `/docs/api` in-app
  (trilingual) — keep in sync with `docs/PUBLIC_API.md` (the reviewable source).

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
- **Overview** — stats + revenue totals; copy-review-link on completed appointments; mark no-show.
- **Weekly calendar** — view/manage bookings, add manually (incl. recurring series), approve/reject/
  cancel pending; attach and SMS-send a meeting link on online appointments.
- **Analytics** (migration 096) — a money-first dashboard for a chosen range (30/90/365 days) from
  the pre-aggregated `get_org_analytics` RPC: revenue + revenue-per-staff, booking/completion counts,
  **no-show / cancellation / repeat-customer rates**, busiest-weekday & busiest-hour histograms
  (business time) and deposit collection. Charts are dependency-free CSS bars.
- **Realtime in-app notifications** (owner bell) for new bookings.
- **Settings** (grouped by concern, `SETTINGS_GROUPS` in `DashboardLayout.tsx`):
  - **Business:** Business info (name/description/contact phone/address/logo — path kept at
    `/settings/profile`), Services (incl. per-service photo galleries), Working hours, Team
    (invite members / add non-login professionals with photos).
  - **Booking page:** everything customers see — shareable link + embed snippet, color theme
    (5 presets **or a custom brand hex**), reviews toggle, require-approval toggle — plus
    **API keys** (mint/revoke, `/settings/api`).
  - **Billing:** Payment credentials, Subscription (current plan, usage meter, upgrade cards).
  - **Account:** delete-account danger zone.
- **Erase client data** action on an appointment (anonymizes the client's PII — Art. 16).
- **Visual theme:** calm/mature flat hairline look via `theme/theme.ts`; accent is **"Deep
  Harbor"** dark Prussian blue `#1D5B84` (2026-07-08, replacing terracotta). The public booking
  flow is exempt: `makeBookingTheme` re-pins the older lifted/citrus card+button look for
  `/book/*` and `/review/*`.

### Superadmin panel (`/superadmin`)
- Platform overview (stats), org list (**searchable by phone** — login is phone-based) & org
  detail with tier overrides, **on-behalf setup panel** (configure a business's services, staff
  and hours for concierge onboarding), the **setup-requests queue** (078), and multi-superadmin
  management. All backing RPCs gate on `is_superadmin()`.
- When a superadmin changes an org's tier they must also set `subscription_expires_at`
  (subscription state is derived — see below).

## Pricing & subscription (migrations 072 + 083, entitlements 088)
- **Two tiers** (083, 2026-07-16 — the product targets individuals and small businesses; the
  old Starter/Pro/Business ladder is gone, Business removed entirely):
  - **Solo ₾19/mo** — 100 **included** appointments/mo
  - **Team ₾39/mo** — 300 **included** appointments/mo (the recommended plan)
- **Included allowance + metered overage** (088, 2026-07-17): the tier's included appointments are
  free; **bookings beyond the allowance are ALLOWED and metered as overage** (recorded in
  `overage_events`, ₾ per `tier_overage_prices`), not blocked. Only an **expired** org (no active
  sub/trial) is hard-blocked. During the trial, overage is a **soft allowance** (metered as usage,
  no billable events). *Charging* overage/subscriptions is a separate billing-integration track —
  today the platform **enforces, meters, records, and displays** overage but does not charge it.
- **Seats are unlimited on both tiers** (088 set `tier_staff_limits` null/null) and **no feature is
  gated** — the tiers differ only by included volume + price. `platform_config.tier_features` plus
  the client `FeatureGate`/`useEntitlement` seam exist (all-true today) so a feature can be gated
  later with a config flip.
- **No free tier** (072). Every new org gets a **30-day Solo-level trial** (no card). Subscription
  state (**trial / active / expired**) is **derived** from `trial_ends_at` /
  `subscription_expires_at` — no cron. An expired org is never disabled: dashboard, data and the
  booking page stay alive, but new bookings are blocked and day-before reminders stop.
- Config lives in `platform_config.tier_limits` / `tier_prices` / `tier_overage_prices` /
  `tier_features` / `tier_staff_limits` JSON (superadmin-editable, no deploy). Enforced **in the
  database**: `enforce_appointment_limit` (hard-blocks only expired orgs) + `record_appointment_overage`
  (AFTER-insert metering, voids on cancel), plus a billing-column guard trigger that blocks owner
  self-upgrades. `get_org_entitlements` is the one RPC the dashboard reads (allowance/overage/seats/
  features); `create-payment` recomputes the charge from `tier_prices` server-side.
- Landing page shows the same two public price cards (`lib/tiers.ts` mirrors this config).

### Limit / expiry UX (what the user actually sees)
- **Owner, approaching/over the allowance:** the dashboard `UsageMeter` and the Subscription page
  turn the usage bar amber at 80%; once **over the included allowance** it shows **"N over your
  plan · ₾Z"** (the metered overage) — bookings are **not** blocked (088).
- **Owner, trial ending:** a countdown banner on the dashboard for the last 7 trial days; after
  expiry a one-time prominent notice (dismissal persisted in `trial_expiry_ack_at`), which
  collapses into a permanent non-dismissible "choose a plan" strip. All in-app; never SMS.
- **Guest, org expired:** the public booking page pre-checks `org_can_accept_appointment` (now
  false only when expired) and shows a friendly "unavailable" state instead of the form; the
  expired hard-block surfaces the trigger's `limit_reached` error gracefully. The public API
  returns 403 `quota_exceeded` only for an expired org.

## Booking add-ons: deposits, self-service, recurring

### Deposits / prepayment (migrations 089/090/091)
- A business can require an **upfront deposit** (or full prepayment) to confirm a booking — the
  strongest no-show killer. Configured **per service** (none / fixed ₾ / percent, in Services
  settings; a fixed deposit can't exceed the price) with an org default; the org-level
  cancellation/refund policy (`cancellation_window_hours`, `deposit_refundable`) lives in Payment
  settings. Percent 0–100 and fixed ≥ 0 are DB-CHECK-enforced.
- A deposit **forces the online path** on the booking page (pay-in-person would bypass it); the
  charge is computed server-side (`lib/deposit.ts` + a Deno mirror) and routed through the existing
  `create-payment` → `payment-webhook` rails. The appointment materialises only after the charge
  clears, with `payment_status = deposit_paid` (balance due in person) or `paid` (full prepay).
- **`no_show`** is a first-class appointment status (owners "mark no-show"); it still counts toward
  usage (the slot was consumed) and keeps any deposit per policy.

### Customer self-service reschedule / cancel (migration 092)
- Every confirmation can carry a **`/manage/:appointmentId`** capability link (UUID = capability,
  like `/review`). The customer reschedules or cancels **without logging in**, but each mutation is
  **OTP-gated** (`manage-appointment` edge fn delegates to the booking-OTP functions server-side).
- Reschedule re-validates the new slot under the per-org advisory lock (409 on race);
  cancel applies the refund policy (refunds the deposit/payment iff within
  `cancellation_window_hours` and `deposit_refundable`, via the payments seam, atomic-claim-then-
  refund like the owner cancel).

### Recurring appointments (migration 095)
- Owner/staff-created **standing bookings** (weekly / biweekly / monthly) for trainers, clinics and
  regular clients — a "Repeat" option in the manual add-appointment dialog. Each occurrence is a
  **real appointment row** carrying a `series_id` (materialized, so reminders/capacity/calendar see
  them). The series is **bounded** (end after N occurrences, or on a date; capped at 52) and all
  occurrences are generated at creation (`create_recurrence_series`, owner context) — colliding
  slots are **skipped and reported** (`{made, skipped}`), never silently dropped; each occurrence
  meters against the tier allowance. Per-occurrence confirmation SMS is suppressed for series rows.
- Edits: "this occurrence" is the normal single cancel/reschedule; **`cancel_recurrence_series`**
  ends the series and cancels all future occurrences.

## Data protection & privacy (Georgian Law on Personal Data Protection, No. 3144)
- **Privacy Policy + Terms** (canonical markdown in `docs/legal/`, in-app pages at `/privacy`,
  `/terms`, rendered from `pages/legal/legalContent.ts`; Georgian is the legally authoritative
  text, English provided; other UI languages fall back to English. Placeholders pending
  legal-entity details). `CONSENT_VERSION` (stored with each consent) is bumped on substance
  changes — currently `2026-07-15`.
- **Consent** captured (with version) at booking and registration; stored on `customers` /
  `pending_bookings`. API-created bookings record consent as vouched by the key holder.
- **Retention** (migrations 064/065): a daily `purge_expired_data()` pg_cron deletes stale
  verification codes, parked bookings and old SMS logs, and **anonymizes** appointments/customers
  past the window (kept for revenue/tax) — windows tunable in `platform_config.retention_config`.
- **Erasure**: `erase_customer_data(appointment_id)` RPC (org-scoped; phone-constraint interplay
  fixed in 076).

## Key domain model
- `organisations` (one per owner; `subscription_tier`, `subscription_expires_at`,
  `payment_config`, `booking_theme` — preset key or custom `#RRGGBB`; `reviews_enabled`,
  `require_approval`, `address`)
- `org_members` + `invitations` (team; phone-based invites; `staff` = non-login bookable profile
  with optional photo)
- `services` (name, duration, price, `max_per_slot` capacity, in-person/online location type),
  `service_staff` (who performs what), `service_images` (per-service gallery, composite-FK
  tenant-integrity pattern; `service-images` bucket)
- `appointments` (+ `meeting_link` for online ones; `payment_status` incl. `deposit_paid`; status
  incl. `no_show`) + shared `customers` (name + phone; consent fields; `anonymized_at`)
- Entitlements/overage (088): `overage_events` ledger; `platform_config.tier_overage_prices` /
  `tier_features`
- Deposits (089): per-service + org `deposit_type`/`deposit_value`; org `cancellation_window_hours`
  / `deposit_refundable`
- `reviews` (one per appointment; org-scoped read; public aggregate exposed via `get_public_org`)
- `api_keys` + `api_rate_counters` (public API; hashed keys, per-minute counters)
- `setup_requests` (concierge-onboarding queue; one open per org)
- Verification: `booking_verifications` / `password_reset_verifications` (hashed OTP challenges);
  `otp_rate_limits` config in `platform_config`
- Availability: `working_hours_template` (weekly) + `working_hours_overrides` (per-date)
- Payments: pluggable providers in `_shared/payments/` (mock-first; BOG/TBC scaffolded),
  `pending_bookings` for online-pay intents, payment columns on `appointments`
- SMS: event-driven — a DB trigger (or RPC) enqueues, the `send-sms` edge function dispatches
  through a pluggable `SmsProvider` (`_shared/sms/`); currently a **mock** provider. Message types
  include booking confirmation, approval updates, day-before appointment reminders
  (`dispatch_appointment_reminders` cron), meeting links, invitations, verification codes,
  setup-complete, and refund/reschedule/cancellation updates. Go-live
  checklist for a real gateway: `docs/SMS_PROVIDER_READINESS.md` (note: `to` numbers need `+995`
  prefixing). The customer-facing `manage-appointment` edge fn sends directly.
- `pg_cron`: auto-complete past appointments; booking notifications & reminders; retention purge
- Account deletion cascades all org data (+ best-effort storage cleanup)

## Security & multi-tenancy
- **RLS everywhere.** Tenant-isolation hardening shipped in migration `066_security_hardening.sql`:
  a `prevent_role_escalation` trigger (no member self-promotion to owner), `organisations` SELECT
  scoped to own-org/superadmin (payment secrets no longer readable cross-tenant), and anon reads of
  `appointments` removed in favor of the org-scoped RPCs above.
- **Guest-insert normalization** (069, extended in 081): a BEFORE INSERT trigger
  (`normalize_guest_appointment`) pins untrusted guest inserts to `payment_status=unpaid` /
  `payment_method=in_person`, derives `status` server-side from `require_approval`, nulls
  provider/reference/admin_notes, enforces service↔org tenant integrity, pins duration from the
  service row, and validates a named staff member — blocking self-approve, self-mark-paid, and
  review-bombing via fabricated `completed` rows. Service role (payment-webhook), superadmins and
  members of the target org are exempt.
- **OTP / SMS-pumping rate limits** (070): both code-sending endpoints (`request-booking-otp`,
  `request-password-reset`) record the caller IP and consult `check_otp_rate_limit` before
  issuing — per-IP burst + daily caps, a per-phone daily cap, and a platform-wide daily
  circuit-breaker, counted across both verification tables. Superadmin-tunable in
  `platform_config.otp_rate_limits` (production defaults: 5/10min and 20/day per IP, 6/day per
  phone, 1000/day global). Blocked booking requests return `too_many_requests` (surfaced in the
  UI); password-reset stays neutral (`ok: true`).
- **Internal-function lockdown** (073 + 081): default PUBLIC/anon EXECUTE revoked from the
  internal cron/helper functions (`dispatch_appointment_reminders`,
  `complete_elapsed_appointments`, `org_usage`, `org_subscription_state`, `purge_expired_data`).
- **2026-07-12 audit fixes** (081 + all edge functions redeployed): anon customer INSERT now
  OTP-gated (was `WITH CHECK(true)`), edge-function error-detail leakage stopped (500s log
  server-side only), `search_path` pinned on core SECURITY DEFINER helpers, storage buckets get
  image-only MIME allowlists, `pg_trgm` moved out of `public`. Outstanding dashboard-only items:
  `pg_net` schema (non-relocatable) and enabling Auth "leaked password protection".
- Edge-function fixes from the 069 pass: `reset-password` v6 (OTP attempt budget summed across
  live challenges) and `payment-webhook` v9 (amount/currency validated against the stored intent
  for real providers).
- Public reads go through SECURITY DEFINER RPCs that strip secrets: `get_public_org`,
  `get_booking_confirmation`, `get_org_busy_slots`, `get_manage_context`.
- **Capability links** (`/review`, `/manage`): the row UUID is the
  capability; reads return stripped jsonb and every mutation is OTP-gated. The writer RPC
  (`reschedule_appointment_slot`) is service-role-only; the customer edge
  fns delegate OTP to `request-booking-otp`/`verify-booking-otp` server-side (no test bypass in the
  new functions).
- Storage buckets (`logos`, `member-photos`, `service-images`) are folder-scoped per org.

## Build status

**Built & live** (migrations through `096` on `dnmecnpugjxkjonqsfxx`):
- Appointments end-to-end: 4-step onboarding (or concierge setup) → settings → public booking with
  OTP → owner notification → dashboard approval (or auto-approve) → completion → verified review.
- Phone auth with OTP second step; OTP password reset.
- Marketing landing page; trilingual public dev docs (`/docs/api`, `/docs/widget`); legal pages
  with English fallback for non-Georgian languages.
- Public REST API v1 with per-org keys, rate limiting, and key management UI.
- Embeddable widget (all tiers) with auto-height, `vis:booked` event, and language pinning.
- Per-service photo galleries; staff profiles with photos; per-appointment meeting links with
  owner-sent SMS.
- Online-payment plumbing via `create-payment`/`payment-webhook` (mock gateway); Solo/Team pricing
  with 30-day trial. **Entitlements substrate** (088): included allowance + metered overage
  (`overage_events`, not blocked), unlimited seats both tiers, `get_org_entitlements` + FeatureGate.
- **Deposits / prepayment** (089–091): per-service deposit config, `deposit_paid` + `no_show`
  statuses, booking forces online when a deposit is required.
- **Customer self-service** (092): `/manage/:appointmentId` OTP-gated reschedule/cancel-with-refund.
- **Recurring appointments** (095): owner-created weekly/biweekly/monthly series (bounded,
  materialized occurrences); `create_recurrence_series` / `cancel_recurrence_series`.
- **Owner analytics** (096): `get_org_analytics` RPC + a money-first dashboard (Dashboard →
  Analytics) with CSS-bar charts.
- Themed booking pages incl. custom brand color; business-timezone (+04:00) slot logic; regrouped
  settings IA; Deep Harbor admin theme.
- Data-protection compliance (privacy/terms/consent/retention/erasure); security hardening passes
  066, 069, 070, 073, 081.
- Concierge onboarding queue + superadmin on-behalf configuration.

**Not built / not real yet:**
- **Real SMS delivery** — only a mock provider (codes/messages are logged, not sent). The provider
  seam and go-live checklist are ready (`docs/SMS_PROVIDER_READINESS.md`).
- **Real payment gateway** — BOG/TBC providers are scaffolded but run against a **mock** gateway;
  not production-wired. Subscription-billing checkout is likewise not wired to a real charge.
- Customer self-service cancel/reschedule, CRM/customer directory, analytics, data export,
  auto-SMS review invites.
- Russian translations of the legal documents (Russian UI users see the English text).
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
