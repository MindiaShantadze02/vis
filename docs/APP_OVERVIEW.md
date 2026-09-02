# Vis — Appointment Booking SaaS

> Product name **Vis**. Hosted Supabase project ref `dnmecnpugjxkjonqsfxx`.
> Migrations run through `20260818120000_appointment_refunds.sql` (2026-08-18); everything
> through that is **pushed to prod**. Verify with `supabase migration list --linked` (remote
> versions are re-timestamped on push, so match by *name*, not number).
>
> For diagrams of how the client, edge functions and database fit together, see
> [ARCHITECTURE.md](ARCHITECTURE.md).

## What it is
A multi-tenant SaaS platform for the **Georgian market** that lets small service businesses
(salons, spas, clinics, trainers, barbers, etc.) take online appointment bookings. Each business
gets a **public booking page** (`/book/[slug]`) to share on social media or **embed on its own
website**. End customers book as **guests**
(no account — name + phone, verified by an SMS code). Owners manage everything through an admin
dashboard. The product front door is a **marketing landing page** at `/`.

> **Appointments-only.** Restaurant and hotel verticals were fully removed in
> `059_appointments_only.sql` (2026-07-02). There is one product: appointment booking.

> **Bookings come from customers only.** The owner-side *manual add-appointment* dialog and
> **recurring appointments** were removed 2026-08-13 — Vis is a pure online-booking platform, so
> every appointment originates from the public booking flow. Owners cancel
> (with refund), mark no-show, reassign staff, attach meeting links and block time ("Rest").

> **Appointments are created `approved` unless the business opts into manual approval.**
> Removed 2026-08-14, re-added 2026-08-22 (`20260822120000`) in a narrower form:
> `organisations.require_approval` (default **false**) gates **on-site bookings only** — anything
> paid online or carrying a deposit is always auto-approved, because the money has already moved.
> A pending request:
> - does **not** hold its slot (someone else can still book that time), so `approve_appointment`
>   re-checks capacity under the per-org advisory lock and can fail with `slot_taken`;
> - is **not billable** — `close_billing_period_for_org` and `get_org_billing_status` count only
>   `('approved','completed','no_show')`, so Vis charges nothing until the owner approves;
> - sorts first in `search_appointments` and raises a `pending_approval` notification;
> - is auto-rejected once its slot time passes (`reject-elapsed-pending` cron, every 5 min).
>
> Approving fires the existing `send_appointment_sms` "reached approved" arm → the customer's
> confirmation SMS. A **human** rejection sends an `approval_update` decline SMS; the cron sweep
> is silent (it has no `auth.uid()`, which is the condition the trigger tests).

## Tech stack
- **Frontend:** React 19 + TypeScript + Vite, MUI v9 + MUI X (DataGrid, Date Pickers), React Router v7, framer-motion, Phosphor icons
- **Backend:** Supabase only (Postgres + Auth + Edge Functions + Realtime + Storage) — **no separate Node server**
- **Edge Functions (Deno):** `request-booking-otp`, `verify-booking-otp`, `create-payment`, `payment-webhook`, `refund-payment`, `manage-appointment`, `save-card`, `send-sms`, `request-password-reset`, `reset-password`, `delete-account`. (Legacy `get-available-slots`, `book-appointment`, `claim-waitlist` and `api` — the withdrawn public REST API — are 410 tombstones pending dashboard deletion.)
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
- **Changing a password is OTP-gated too** (Settings → Account, 2026-08-18): a live session is no
  longer sufficient, since an unlocked laptop or a stolen token could otherwise be used to take the
  account over silently — a password change is the one action that locks the real owner out. The
  form is two steps (new password → 6-digit code) and reuses the recovery pair
  `request-password-reset` → `reset-password`, so the hashed challenge, 5-attempt budget, 60s
  resend cooldown and SMS-pumping caps all apply unchanged. The phone always comes from the
  **session**, never an input, so the code can only reach the account's own number.
  Note `reset-password` carries **no** `000000` test bypass (unlike `verify-booking-otp`), so no
  test can drive this to completion — the e2e covers everything up to the code and then proves the
  password did not change.
- **Timezone:** all customer-facing booking logic is pinned to **business time (Georgia, fixed `+04:00`)** via helpers in `client/src/lib/slots.ts` (`businessDayWindow`, `businessDayKey`, `toBusinessWallClock`, …) so slots don't shift with the viewer's browser zone. The admin dashboard intentionally stays viewer-local.
- **Testing:**
  - **Playwright e2e** — 33 spec files / 94 tests; 91 pass and 3 skip without a service-role key
    (`cd client && ./node_modules/.bin/playwright test`), run against the hosted project via the
    dev server; booking OTP master code `000000`. Includes a
    **data-driven layer**: BVA/ECP rows live in `e2e/data/*.json`, executed by
    `e2e/data-driven/*.spec.ts`, with `consistency.spec.ts` guarding that data-file boundaries match
    the app's real limits.
    ⚠️ **Run it in batches, not one invocation** — ~90 logins from one IP crosses the `ip_burst`
    OTP cap (070) and every later test then fails waiting for the OTP field. Use the local binary;
    `npx playwright` pulls a mismatched version.
  - **Vitest unit layer** — 7 files / 176 tests (`cd client && npm run test`) for pure logic:
    `validation`, `slug`, `slots`, `billing`, `deposit`, `analytics`, `acquisition`. (The
    client↔Deno slot-parity suite went with the REST API that needed the second copy.)
- **Validation UX conventions:** submit buttons are **never disabled for validation** — validate on
  click and show inline per-field errors (`aria-invalid`), scrolling to the first invalid field.
  Banners/toasts are reserved for server errors.
- **Hosting:** Vercel (SPA). `client/vercel.json` sets `frame-ancestors` so `/book/*` may be embedded anywhere while the dashboard/login are frame-blocked (clickjacking protection).
- **Currency:** Georgian Lari (₾)

## User roles
1. **Guest customer** — books publicly, no login; verifies phone via SMS OTP
2. **Business admin / org members** — manage their org (multi-admin via phone invitations; roles owner/admin/member; non-login `staff` profiles for bookable professionals)
3. **Superadmin** — platform owner; manages all orgs, overrides billing status, works the concierge-setup queue, views platform stats

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

### Public booking (guest; OTP only when the org bought the SMS add-on)
1. **Service** (with a per-service **thumbnail** on each card, `services.image_url`) →
   **date/time** (staff pick or "any available")
   → **customer details** (name + phone, optional notes, required Privacy/Terms consent). There is
   **no payment-method choice** — every priced booking pays online.
2. **Phone OTP — only at orgs with `sms_enabled`** (off by default, 2026-09-03). When on,
   `request-booking-otp` sends a hashed code and `verify-booking-otp` checks it, and the DB trigger
   `enforce_booking_verification` only lets the insert through once the phone is verified. When
   off, the phone is collected but never verified and the step is skipped entirely — the same
   trigger returns early, which also lets the payment webhook's insert through.
3. **Finish — online or on site.** Two routes, and which are offered is derived, never guessed:
   - **Online** (any service with a price > 0): nothing is written yet — `create-payment` parks
     the intent in `pending_bookings` and redirects to the gateway; `payment-webhook` creates the
     row only after the charge clears (abandoned payments leave no orphan booking), always as
     **`approved`**. A deposit charges the deposit; otherwise the full price. The gateway is
     chosen **platform-wide** by `getPaymentProvider` — the per-org `payment_config.bog/tbc`
     entries are credential slots, *not* an availability switch.
   - **On site** (`payment_config.in_person.enabled`, default on): the customer pays at the
     appointment. The rows are written by the **`create_guest_booking` RPC** (re-introduced
     2026-09-03 — SECURITY DEFINER, anon-executable). It exists because `customers` is a global
     table with no `org_id`, so its OTP-gated INSERT policy cannot express a *per-org* opt-out;
     moving the write server-side also lets the RPC rate-limit unverified bookings per phone and
     hide the blocklist refusal from a caller who proved nothing. Every appointment trigger still
     runs: `trg_00_normalize_guest_appointment` pins `status=approved` / `payment_method=in_person`
     / `payment_status=unpaid`, `trg_enforce_slot_capacity` re-checks capacity under the per-org
     advisory lock, and `trg_enforce_appointment_limit` applies the billing gate. `anon` no longer
     has any direct INSERT on `customers`.
   - **A ₾0 service is on-site only** (`create-payment` rejects a zero charge with
     `invalid_amount`), and **a deposit is online only** — collecting it is the point, and the
     normaliser raises `deposit_required` on the direct path. The Online / On site selector
     appears only when both are genuinely available, defaulting to Online.
   Either way it lands on `/booking-confirmation/:id` (data via `get_booking_confirmation`).
- The confirmation SMS includes the business's **street address** when set
  (`organisations.address`, migration 077). It is sent **once**, at creation; the only other
  automatic customer message is the morning-of reminder (see SMS below).
- **Online services:** the meeting link is **per-appointment**, not per-service (migration 082 —
  `appointments.meeting_link`; `services.meeting_link` is dead). The owner attaches a link to an
  online appointment on the dashboard and sends it by SMS via the `request_meeting_link_sms` RPC.
- Availability is read through the `get_org_busy_slots` SECURITY DEFINER RPC (org-scoped; anon has
  no direct read on `appointments`). Slots are computed client-side — no pre-generated slots table.
- **Unpaid businesses can't take bookings** — see *Billing* below. The page pre-checks
  `org_can_accept_appointment` and shows a neutral "not accepting bookings right now" state
  (deliberately *not* "they haven't paid").

> **Test SMS code:** enter **`000000`** at the OTP step. Temporary hosted bypass (see flags below).

### Embeddable booking widget
- Any business can embed its form on its own website. Detection: `?embed=1` or `window.self !==
  window.top`. In embed mode the form renders **bare** (no business sidebar/branding — the host
  site provides it), on a clean background; `?lang=ka|en|ru` pins the widget language.
- `client/public/embed.js` (pasted by the business) auto-sizes every `iframe[data-vis]` via a
  `postMessage` bridge (`pages/book/useEmbedBridge.ts`), accepts messages only from the iframe's
  own origin, and breaks the payment redirect out to the top window. A completed booking
  dispatches a **`vis:booked` DOM event** on the iframe element for host-page analytics.
- Available to every business; the embed snippet lives in **Settings → Booking page** next to the
  booking link.
- Public docs: `/docs/widget` (trilingual, no auth).

### Reviews (verified, appointment-bound) — migration 068
- Each **completed** appointment's UUID doubles as a capability link `/review/:appointmentId`
  (`pages/review/ReviewPage.tsx`) — only a real attendee can review, **one review per appointment**
  (UNIQUE on `appointment_id`). V1 delivery: the owner copies the review link from a completed
  appointment on the dashboard (auto-SMS invites are a later upgrade).
- Owner control is a single on/off toggle `organisations.reviews_enabled` (no per-review
  hide/delete — keeps ratings un-gameable). Lives in Settings → Booking page.
- The public booking page (and embed) shows **only the aggregate rating** (avg ★ + count, via
  `get_public_org`) in the branded sidebar — deliberately no per-review list. RPCs:
  `submit_review`, `get_review_context`, `get_public_reviews`.

### Admin dashboard
- **Overview** — stats + revenue totals; filterable/searchable appointment list; detail drawer with
  staff reassignment, notes, payment state, copy-review-link on completed appointments, meeting-link
  send, cancel (with refund choice), mark-no-show, and a **standalone Refund** (money only —
  see below).
- **Weekly calendar** — week grid (desktop) / single-day timeline (mobile) with service-coloured
  pills, same-service overlap grouping, and block time ("Rest"). The detail drawer is read-only
  apart from staff reassignment and the Refund action. No manual entry — bookings arrive from the
  public booking flow.

### Refunds (086 + `20260818120000`)
- Two doors, one edge function (`refund-payment`, JWT + org membership):
  - **Cancel with refund** — the checkbox in the cancel dialog. Atomic: a refund failure reverts
    the cancellation, so money-state and booking-state only ever move together.
  - **Standalone Refund** — the drawer button, reachable from *any* status. Returns the money and
    cancels the booking **only if it was still approved**; a completed or no-show visit keeps its
    status, so history and the billable count are not rewritten.
- Refundable = online payment, `paid` **or** `deposit_paid`, with a gateway reference. The amount
  always comes from `payment_log` (what was charged), never `services.price`. Full refunds only.
- `mode: 'quote'` returns the amount for the confirm dialog without opening `payment_log` (which
  also holds platform subscription charges) to org members.
- **`appointment_refunds`** is the org-readable ledger: amount, actor (`initiated_by` +
  snapshotted name), reason, `initiated_via`, and whether it cancelled. Written service-role only,
  `pending` before the gateway call so a crash mid-refund is reconcilable.
- **Clients** — customer directory grouped client-side, with the Art. 16 **erase client data**
  action (anonymizes PII via `erase_customer_data`), plus a per-org **blocklist** on a second tab.
- **Blocking a number** (migration `20260819120000`) — the business's last resort against a phone
  that abuses its booking page. `blocked_customers (org_id, phone)` is **org-scoped only**: it
  never bars anyone platform-wide, and RLS ties writes to the caller's own org. Phones are
  normalised on write (`normalize_ge_phone`), so a pasted `+995 …` matches the stored 9-digit form.
  Enforced entirely server-side via `is_phone_blocked`, with **no trusted-caller bypass**:
  `trg_zz_block_blocked_customer` (BEFORE INSERT on `appointments`, so the service-role
  payment-webhook insert is covered too), `reschedule_appointment_slot`, and `submit_review`.
  Two edge functions refuse earlier so an abuser stops costing the business money:
  `request-booking-otp` declines **before generating or sending a code**, and `create-payment`
  declines before charging. Neither is the control — bypassing either still hits the trigger.
  `manage-appointment` is exempted from the OTP gate (it proves itself with the service-role key
  in an `x-internal-key` header — the gateway rewrites `authorization`, so a bearer comparison
  never matches server-to-server) because **cancelling stays open** to a blocked customer and
  cancelling needs a code. A block stops new bookings and reschedules only: existing appointments
  stand and the business cancels them itself, same reasoning as the billing block.
  Two ordering notes worth keeping: the trigger sorts **after**
  `trg_enforce_booking_verification`, and `create-payment` checks **after** its OTP check —
  earlier in either case would let anyone probe an org's blocklist without owning the phone. The
  pre-send OTP refusal knowingly accepts that residual (it answers "has org X blocked phone Y" to
  someone who already knows both) in exchange for not paying to text an abuser; it sends nothing
  and stores nothing, so it cannot burn the real owner's daily code budget.
- **Analytics** (migration 096) — a money-first dashboard for a chosen range (30/90/365 days) from
  the pre-aggregated `get_org_analytics` RPC: revenue + revenue-per-staff, booking/completion counts,
  **no-show / cancellation / repeat-customer rates**, busiest-weekday & busiest-hour histograms
  (business time) and deposit collection. Charts are dependency-free CSS bars.
- **Realtime in-app notifications** (owner bell) for new bookings.
- **Settings** (grouped by concern, `SETTINGS_GROUPS` in `DashboardLayout.tsx`):
  - **Business:** Business info (name/description/contact phone/email/address/logo — path kept at
    `/settings/profile`), Services (incl. a per-service thumbnail), Working hours, Team
    (invite members / add non-login professionals with photos).
  - **Booking & payments:** Booking page (shareable link + embed snippet, cover image, color theme
    — 5 presets **or a custom brand hex** — and the reviews toggle) and Payment (accept-on-site
    switch, gateway credentials, cancellation window, org-default deposit).
  - **Account & billing:** Billing (running bill, card on file, invoices, pay now), the
    delete-account danger zone.
- **Visual theme:** calm/mature flat hairline look via `theme/theme.ts`; accent is **"Deep
  Harbor"** dark Prussian blue `#1D5B84`. The public booking flow is exempt: `makeBookingTheme`
  re-pins the older lifted/citrus card+button look for `/book/*` and `/review/*`.
- **Shared dashboard pieces:** `types/appointment.ts` (one `Appointment`/`StaffRef` shape +
  `APPOINTMENT_SELECT`), `hooks/useStaffAssignment.ts`, `components/AppointmentDetails.tsx`
  (the shared drawer body) — Overview and Calendar both build on these.

### Superadmin panel (`/superadmin`)
- Platform overview (stats), org list (**searchable by phone** — login is phone-based) & org
  detail with **billing-status override**, **on-behalf setup panel** (configure a business's
  services, staff and hours for concierge onboarding), the **setup-requests queue** (078), and
  multi-superadmin management. All backing RPCs gate on `is_superadmin()`.

## Billing — flat subscription + SMS add-on (2026-09-03)

A business pays a **flat ₾15 a month**, billed monthly in arrears, whether or not it took any
bookings. On top of that, orgs that switch on the **SMS add-on** (`organisations.sms_enabled`,
off by default) pay **₾0.7 per appointment** for the messages it sends. The first period an org
ever closes is free of the base fee; SMS charges still apply in it.

This replaced the 2026-07-24 post-paid model, which charged ₾1 per appointment and nothing in an
empty month. Signup is still free — no tiers, no plans, no trial, no credits, no quota.

- **Model:** `platform_config.billing_config` — `base_monthly_fee` **15**,
  `sms_appointment_price` **0.7**, `minimum_charge` 0, `notice_days` 3, `retry_schedule` `[1,3,7]`,
  `grace_days` 7 (superadmin-editable, no deploy). `appointment_price` is retired and deliberately
  absent, so anything still reading it fails loudly rather than invoicing nothing.
- **What is counted:** `appointments.sms_billable`, stamped at INSERT by
  `stamp_appointment_origin` — true only for a public booking at an org with the add-on on.
  Billing never reads the live org flag, so turning the add-on off changes what future bookings
  cost and never rewrites a closed period. That is why the toggle is safe to leave owner-writable
  (unlike `billing_status` / `billing_exempt`).
- **Tables:** `billing_periods` (one invoice per org per month, `open → pending → charged |
  failed | waived`, UNIQUE `(org_id, period_start)`), `billing_line_items` (immutable ledger with a
  `kind` of `base` / `sms` / the legacy `appointment`; two partial unique indexes keep one base row
  per period and one row per appointment per kind across periods), `org_payment_methods` (provider
  token only, never a PAN), `billing_events` (audit).
- **Two pg_cron jobs:** `billing-close` (03:00) walks each org from its `usage_anchor` and opens a
  `pending` invoice for the base fee plus the SMS-billable appointments whose final status is
  `approved`/`completed`/`no_show`; `billing-charge` (03:30) attempts the charge after the notice
  window.
- **Dunning:** a failed charge → `past_due`; after `grace_days` or exhausted retries → `suspended`.
  Paying clears everything — `settle_usage_charge` flips the org back to `active` once nothing is
  `pending`/`failed`.
- **Owner UI:** Settings → Billing shows the running bill (`get_org_billing_status` → `UsageMeter`),
  card on file, past invoices, and **Pay now** (`pay_org_outstanding`, shared with the blocking
  modal via `useBillingPayment`). Adding a card **never charges**.
- **Card on file:** `store_org_card` writes it (`20260724150000`) and `remove_org_card`
  (`20260820120000`) takes it off. Both are SECURITY DEFINER — `org_payment_methods` has no client
  write policy — and both **retire** the old row (`is_default = false, status = 'removed'`) rather
  than deleting it, so charge history survives and the partial-unique default index is freed.
  Removal is allowed **while a bill is outstanding**: it can't dodge collection (a due charge with
  no card still routes into dunning, `20260729120000`), and trapping an owner's card details on a
  platform they're leaving is the worse failure. Owners read display metadata only — the `token`
  column is revoked from `authenticated`.
- **Card entry** (`client/src/lib/card.ts`) reformats as you type instead of demanding one exact
  shape: the number groups in fours (Amex 4-6-5) and the expiry normalises to `MM/YY` from `0929`,
  `9/29`, `09 - 2029` and so on. The expiry parser respects an explicit separator rather than
  reading the digit run positionally, so `9/29` is September, not month 92. "Unreadable" and
  "expired" are distinct inline errors.
- Owners cannot touch their own `billing_status` **or `billing_exempt`** —
  `prevent_billing_self_update` rejects both (service role, superadmin or the
  `app.internal_billing` GUC only).

### Superadmin orgs are never billed (2026-08-17, `20260817120000`)
- `organisations.billing_exempt` → no invoice (`close_billing_period_for_org` returns
  early), no charge attempt, and `org_can_accept_appointment` returns true regardless of
  `billing_status`, so no block and no pay-now modal. The dashboard hides the running
  bill and the Billing page shows a short "not billed" notice instead.
- **It is a guarded column, not a derived check.** "Exempt if the owner is a superadmin"
  would be self-grantable: `organisations_update` covers the whole row (an owner can
  PATCH `owner_id` — verified exploitable), `org_members_insert` accepts any `user_id`
  with `role='owner'`, and the superadmin uuid ships in the browser bundle via
  `VITE_SUPERADMIN_USER_ID`. Instead `pin_org_billing_exempt` **overwrites** the value on
  INSERT with the server's own `is_superadmin()` answer, and updates are frozen.
  `billing.spec.ts` covers the three self-grant attempts.

### Unpaid businesses are blocked (2026-08-16, `20260816120000`)
- **`org_can_accept_appointment` requires `billing_status = 'active'`** — both `past_due` **and**
  `suspended` block. (It previously blocked only `suspended`, so an unpaid business kept taking
  bookings for the whole ~11-day dunning window. That was a live revenue leak.)
- That single predicate is what the `trg_enforce_appointment_limit` BEFORE INSERT trigger,
  `create-payment` and the public booking page all consult, so the block is enforced **in the
  database**, not just the UI. `reschedule_appointment_slot` carries the same gate (it's an
  UPDATE, so the insert trigger never fired for it) and raises `billing_blocked`.
  **Cancelling deliberately stays allowed** — it reduces the business's liability.
- **Customer** sees the neutral unavailable state. **Owner** gets a non-dismissable
  `BillingBlockedDialog` mounted in `DashboardLayout`, showing the outstanding amount and card,
  with Pay now / Add card / Log out. It steps aside on Settings → Billing and Settings → Account
  so the owner can actually settle up, and clears itself when payment lands.
- Client gate: `isBookingBlocked(billing, orgStatus)` in `lib/billing.ts` prefers the fresh
  `billing.status` (so paying clears it immediately) and falls back to
  `organisations.billing_status`, so an RPC failure **fails closed**.

## Booking add-ons: deposits, self-service

### Deposits / prepayment (migrations 089/090/091, re-added 2026-08-06)
- A business can require an **upfront deposit** (or full prepayment) to confirm a booking — the
  strongest no-show killer. Configured **per service** (none / fixed ₾ / percent, in Services
  settings; a fixed deposit can't exceed the price) with an org default; the org-level
  cancellation/refund policy (`cancellation_window_hours`, `deposit_refundable`) lives in Payment
  settings. Percent 0–100 and fixed ≥ 0 are DB-CHECK-enforced.
- A deposit simply charges the deposit amount instead of the full price; the charge is computed
  server-side (`lib/deposit.ts` + a Deno mirror) and routed through the existing `create-payment` →
  `payment-webhook` rails. The appointment materialises only after the charge clears, with
  `payment_status = deposit_paid` (balance due in person) or `paid` (full prepay). A guest-path
  guard in `normalize_guest_appointment` raises `deposit_required` if a deposit service is ever
  pushed down the direct guest-insert path instead of through checkout.
- **`no_show`** is a first-class appointment status (owners "mark no-show"); the slot was consumed,
  so it **counts as billable** and keeps any deposit per policy.

### Customer self-service reschedule / cancel (migration 092)
- Every confirmation can carry a **`/manage/:appointmentId`** capability link (UUID = capability,
  like `/review`). The customer reschedules or cancels **without logging in**, but each mutation is
  **OTP-gated** (`manage-appointment` edge fn delegates to the booking-OTP functions server-side).
- Reschedule re-validates billing, working hours and the new slot under the per-org advisory lock
  (409 on race); cancel applies the refund policy (refunds the deposit/payment iff within
  `cancellation_window_hours` and `deposit_refundable`, via the payments seam,
  atomic-claim-then-refund like the owner cancel).

## Data protection & privacy (Georgian Law on Personal Data Protection, No. 3144)
- **Privacy Policy + Terms** (canonical markdown in `docs/legal/`, in-app pages at `/privacy`,
  `/terms`, rendered from `pages/legal/legalContent.ts`; Georgian is the legally authoritative
  text, English provided; other UI languages fall back to English. Placeholders pending
  legal-entity details). `CONSENT_VERSION` (stored with each consent) is bumped on substance
  changes — currently `2026-08-04`.
- **Consent** captured (with version) at booking and registration; stored on `customers` /
  `pending_bookings`.
- **Retention** (migrations 064/065): a daily `purge_expired_data()` pg_cron deletes stale
  verification codes, parked bookings and old SMS logs, and **anonymizes** appointments/customers
  past the window (kept for revenue/tax) — windows tunable in `platform_config.retention_config`.
- **Erasure**: `erase_customer_data(appointment_id)` RPC (org-scoped), surfaced on the Clients page.

## Key domain model
- `organisations` (one per owner; `billing_status` active/past_due/suspended, `billing_exempt`
  (platform-set, not tenant-writable), `usage_anchor`,
  `payment_config` (`{method: {enabled, …}}`; `in_person` is flag-only and drives the on-site
  option, gateways also carry credentials), `booking_theme` — preset key or custom `#RRGGBB`; `reviews_enabled`,
  `contact_email`, `address`, `cover_url`, org-default deposit config)
  - **`contact_email` is a merchant legal disclosure** (E-Commerce Law Art. 4), published by
    `get_public_org` on the booking page. Mandatory on **both** the onboarding step and
    Settings → Business — it cannot be cleared once set. Format + a 254-char cap are enforced
    server-side by `organisations_contact_email_format` (`20260821120000`); the column stays
    nullable only for orgs created before the field existed, so "not empty" is a form rule and
    "well-formed" is a DB rule.
- `org_members` + `invitations` (team; phone-based invites; `staff` = non-login bookable profile
  with optional photo)
- `services` (name, duration, **price ≥ ₾0** — free services are legal and book on site —
  `max_per_slot` capacity, in-person/online location type, per-service deposit config,
  `image_url` — one thumbnail, stored in the `service-images` bucket),
  `service_staff` (who performs what; also written from onboarding)
- `appointments` — status is `pending | approved | rejected | cancelled | completed | no_show`
  (`pending` only on opt-in `require_approval` orgs, on-site path only);
  `+ meeting_link` for online ones; `payment_status` incl. `deposit_paid`;
  `payment_method` is `online` for public bookings, `in_person` for API/internal writes — plus
  shared `customers` (name + phone; consent fields; `anonymized_at`)
- Billing: `billing_periods`, `billing_line_items`, `org_payment_methods`, `billing_events`;
  `platform_config.billing_config`
- Deposits (089): per-service + org `deposit_type`/`deposit_value`; org `cancellation_window_hours`
  / `deposit_refundable`
- `appointment_refunds` (org-readable refund ledger: amount, actor, reason, cancelled_appointment;
  service-role writes). `payment_log` stays superadmin-only.
- `reviews` (one per appointment; org-scoped read; public aggregate exposed via `get_public_org`)
- `setup_requests` (concierge-onboarding queue; one open per org)
- Verification: `booking_verifications` / `password_reset_verifications` (hashed OTP challenges);
  `otp_rate_limits` config in `platform_config`
- Availability: `working_hours_template` (weekly) + `working_hours_overrides` (per-date)
- Payments: pluggable providers in `_shared/payments/` (mock-first; BOG/TBC scaffolded),
  `pending_bookings` for online-pay intents, payment columns on `appointments`, `payment_log` audit
- SMS: event-driven — a DB trigger (or RPC) enqueues, the `send-sms` edge function dispatches
  through a pluggable `SmsProvider` (`_shared/sms/`); currently a **mock** provider. Customer SMS
  arrives by **two independent routes** — know both before changing either:
  - **DB-driven** (trigger/cron → `net.http_post` → `send-sms`): `booking_confirmation` **once**, when
    a booking reaches `approved`, and `appointment_reminder` on the **morning of** the appointment
    (`dispatch_appointment_reminders` cron, window opens 08:00 business time; same-day bookings
    skipped, and moving a booking re-arms its reminder via `trg_clear_reminder_on_reschedule`). Both
    pinned by migration `20260813130000`. Every other appointment write — cancel, no-show, notes,
    auto-complete — is silent on this route.
  - **Edge functions calling `sendSms` directly** (never touch the trigger): `manage-appointment`
    sends `reschedule_update` / `cancellation_update`; `refund-payment` and `payment-webhook`
    send `refund_update`; `request-booking-otp` / `request-password-reset` send `verification_code`;
    `send-sms` itself sends the owner-facing `setup_complete`. `meeting_link` is owner-triggered via
    `request_meeting_link_sms`.

  Go-live checklist for a real gateway: `docs/SMS_PROVIDER_READINESS.md` (note: `to` numbers need
  `+995` prefixing).
- `pg_cron`: auto-complete past appointments; booking notifications & reminders; retention purge;
  `billing-close` + `billing-charge`
- Account deletion cascades all org data (+ best-effort storage cleanup)

## Security & multi-tenancy
- **RLS everywhere.** Tenant-isolation hardening shipped in migration `066_security_hardening.sql`:
  a `prevent_role_escalation` trigger (no member self-promotion to owner), `organisations` SELECT
  scoped to own-org/superadmin (payment secrets no longer readable cross-tenant), and anon reads of
  `appointments` removed in favor of the org-scoped RPCs above.
- **Guest-insert normalization** (069, extended in 081 / 20260814120000): a BEFORE INSERT trigger
  (`normalize_guest_appointment`) pins untrusted guest inserts to `status=approved`,
  `payment_status=unpaid`, `payment_method=in_person`, nulls provider/reference/admin_notes,
  enforces service↔org tenant integrity, pins duration from the service row, validates a named
  staff member, and raises `deposit_required` when a deposit is owed — blocking self-mark-paid and
  review-bombing via fabricated `completed` rows. Service role (payment-webhook), superadmins and
  members of the target org are exempt.
- **OTP / SMS-pumping rate limits** (070): both code-sending endpoints (`request-booking-otp`,
  `request-password-reset`) record the caller IP and consult `check_otp_rate_limit` before
  issuing — per-IP burst + daily caps, a per-phone daily cap, and a platform-wide daily
  circuit-breaker, counted across both verification tables. Superadmin-tunable in
  `platform_config.otp_rate_limits` (production defaults: 5/10min and 20/day per IP, 6/day per
  phone, 1000/day global). Blocked booking requests return `too_many_requests` (surfaced in the
  UI); password-reset stays neutral (`ok: true`).
- **Security sweep** (2026-08-19, `20260823120000` + edge redeploys) — see
  `docs/SECURITY_PRE_LAUNCH.md` for what is knowingly still open:
  - `prevent_billing_self_update` now freezes **`usage_anchor` and `owner_id`** as
    well as `billing_status`/`billing_exempt`. `organisations_update` has no
    column list, so this trigger **is** the column-level access control — add any
    new sensitive `organisations` column to it. Moving `usage_anchor` forward had
    let an owner suppress invoicing indefinitely.
  - **OTP attempts are now charged atomically** by `claim_booking_otp_attempt` /
    `claim_password_reset_attempt` (`attempts = attempts + 1 … RETURNING`, charged
    before the hash compare). The previous read-modify-write let concurrent guesses
    share a stale counter, making a 6-digit code brute-forceable — on
    `reset-password` that was owner account takeover. Verified live: 20 concurrent
    guesses ⇒ exactly 5 evaluated, 15 refused, `attempts` = 20.
    Two things the budget deliberately does **not** do, both learned by breaking
    the app with them first:
    - it counts only **unverified** live challenges, because nothing sets
      `consumed_at` on the login path, so every successful sign-in would otherwise
      leave a charged row behind and lock the phone out within a few logins;
    - a **successful** verify refunds its own charge (`mark_booking_otp_verified`),
      because signing in again inside the 60s resend cooldown re-verifies the same
      still-live challenge. Wrong guesses are never refunded, so the bound holds.
    `check_otp_rate_limit` is **not** called on the verify side — it caps code
    *issuance* (it counts rows created per IP/phone) and belongs on the request
    side only. At its production defaults, applying it to verification would
    refuse legitimately-issued codes for everyone behind one office NAT.
  - `reset-password` no longer returns `no_account` (phone enumeration).
  - **Grant hygiene:** `anon`/`authenticated` no longer hold table-level ALL on
    `platform_config`, `superadmins`, the two verification tables or
    `org_payment_methods`. Note migration 066's column-revoke on `org_members`
    had been a **no-op** — a column REVOKE cannot carve a subset out of a
    table-level grant; it is done correctly now.
  - ⚠️ `has_verified_booking_otp` **must stay anon-executable**: the
    `customers_insert` policy calls it, and RLS expressions run as the CALLING
    role, so revoking it breaks all guest booking.
- **Internal-function lockdown** (073 + 081): default PUBLIC/anon EXECUTE revoked from the
  internal cron/helper functions (`dispatch_appointment_reminders`,
  `complete_elapsed_appointments`, `purge_expired_data`, the billing settle/charge functions).
- **2026-07-12 audit fixes** (081 + all edge functions redeployed): anon customer INSERT now
  OTP-gated (was `WITH CHECK(true)`), edge-function error-detail leakage stopped (500s log
  server-side only), `search_path` pinned on core SECURITY DEFINER helpers, storage buckets get
  image-only MIME allowlists, `pg_trgm` moved out of `public`. Outstanding dashboard-only items:
  `pg_net` schema (non-relocatable) and enabling Auth "leaked password protection".
- Public reads go through SECURITY DEFINER RPCs that strip secrets: `get_public_org`,
  `get_booking_confirmation`, `get_org_busy_slots`, `get_manage_context`.
- **Capability links** (`/review`, `/manage`): the row UUID is the capability; reads return
  stripped jsonb and every mutation is OTP-gated. The writer RPC (`reschedule_appointment_slot`)
  is service-role-only; the customer edge fns delegate OTP to
  `request-booking-otp`/`verify-booking-otp` server-side.
- Storage buckets (`logos`, `member-photos`, `service-images`) are folder-scoped per org.

## Build status

**Built & live** (migrations through `20260816120000`, all pushed):
- Appointments end-to-end: 4-step onboarding (or concierge setup) → settings → public booking with
  OTP + online payment → owner notification → completion → verified review.
- Phone auth with OTP second step; OTP password reset.
- Marketing landing page; trilingual public widget docs (`/docs/widget`); legal pages
  with English fallback for non-Georgian languages.
- Embeddable widget with auto-height, `vis:booked` event, and language pinning.
- Per-service thumbnails; staff profiles with photos; per-appointment meeting links with
  owner-sent SMS; org cover image.
- Online-payment plumbing via `create-payment`/`payment-webhook` (mock gateway) + refunds
  (`refund-payment`, cancel-with-refund choice, webhook auto-refund on fulfilment failure).
- **Post-paid usage billing**: monthly invoice per org at ₾1/appointment, close + charge crons,
  dunning → `past_due`/`suspended`, card on file, invoices, pay now.
- **Unpaid businesses blocked from taking bookings** (2026-08-16) with a hard-blocking owner
  modal — enforced in the DB across every write path.
- **On-site payment + free services** (2026-08-16): the ₾5 floor is gone (₾0 is legal again) and
  customers can choose to pay at the appointment; org opt-out in Settings → Payment. Deposits
  still force online.
- **Deposits / prepayment** (089–091): per-service deposit config, `deposit_paid` + `no_show`.
- **Customer self-service** (092): `/manage/:appointmentId` OTP-gated reschedule/cancel-with-refund.
- **Owner analytics** (096): `get_org_analytics` RPC + a money-first dashboard.
- Clients page with Art. 16 erase; themed booking pages incl. custom brand color;
  business-timezone (+04:00) slot logic; regrouped settings IA; Deep Harbor admin theme.
- Data-protection compliance (privacy/terms/consent/retention/erasure); security hardening passes
  066, 069, 070, 073, 081.
- Concierge onboarding queue + superadmin on-behalf configuration.

**Not built / not real yet:**
- **Real SMS delivery** — only a mock provider (codes/messages are logged, not sent). The provider
  seam and go-live checklist are ready (`docs/SMS_PROVIDER_READINESS.md`).
- **Real payment gateway** — BOG/TBC providers are scaffolded but run against a **mock** gateway.
  ⚠️ Two independent blockers here:
  1. Any **priced** service checks out through the gateway, so a real provider is required
     before launch or those bookings stall. (Since 2026-08-16 a business can fall back to ₾0 +
     on-site payment, so this no longer blocks the product outright — but it does block charging
     customers online.)
  2. **The business→Vis usage-bill path is mock-only and unimplemented.** `create-payment` has no
     `usage` purpose branch, `payment-webhook` has no `usage` settle branch, and the `charge-usage`
     edge function named by `20260724140000` was never written. Setting a real provider today makes
     `charge_billing_period` return `provider_not_configured` — a plain RETURN, so **billing stops
     collecting silently** — while `pay_org_outstanding` *raises*, killing the Pay-now button. Build
     both before flipping the provider.
- CRM beyond the Clients list, data export, auto-SMS review invites.
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
- The tombstoned `get-available-slots` / `book-appointment` / `claim-waitlist` deployments should be
  deleted from the Supabase dashboard (the management MCP can't delete functions).
