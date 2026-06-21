# Grafiki — MVP Gap Analysis & Feature Roadmap

> Reference doc for future work. The core of the app is built; this tracks what's left to
> make it launchable, monetizable, and retention-driving. Priorities: **P0** = launch
> blocking, **P1** = launch quality / retention, **P2** = growth & polish.

## What's already done (don't re-plan these)

Public 3-step booking flow, admin dashboard (overview + weekly calendar), services /
working-hours / team management, 3-step onboarding wizard, multi-tenant RLS, subscription
tiers with usage tracking & enforcement, in-app realtime notifications, i18n (ka/ru/en),
superadmin tooling, account deletion, auto-complete cron.

---

## P0 — Launch blockers

### 1. Subscription billing — make the upgrade flow real
- **Now:** `SubscriptionPage.tsx` shows tiers + usage but the upgrade button is **not
  wired**. `subscription_payments` table + tier prices exist. Limits already enforced via
  `org_can_accept_appointment`.
- **Work:** BOG/TBC checkout for platform subscriptions (edge function to initiate +
  **webhook/callback** to mark `subscription_payments` paid and bump
  `organisations.subscription_tier` / `usage_anchor`). Wire the button. Handle
  downgrade/cancel.
- **Files:** `client/src/pages/dashboard/settings/SubscriptionPage.tsx`,
  new `supabase/functions/billing-*`, `subscription_payments`, `organisations`.

### 2. Online booking payments — finish BOG/TBC
- **Now:** `PaymentSettings.tsx` collects credentials but both providers are "Coming
  Soon". `PaymentReturnPage.tsx` is a stub. Appointment rows already carry
  `payment_method` / `payment_status` / `payment_provider` / `payment_reference`.
- **Work:** Edge function to create a payment when `payment_method = online`, redirect to
  provider, webhook to set `payment_status = paid` and finalize. Implement
  `PaymentReturnPage`. Handle failed/abandoned payments (release the held slot). Refund
  path (at least manual).
- **Files:** `client/src/pages/book/Step3CustomerForm.tsx`,
  `client/src/pages/book/PaymentReturnPage.tsx`, `PaymentSettings.tsx`,
  new `supabase/functions/payment-*`.

### 3. Outbound notification delivery (SMS + email)
- **Now:** A pluggable SMS layer lives in `supabase/functions/_shared/sms/` behind the
  `SmsProvider` interface. The **mock** provider is active (logs to function logs, records
  every send in `sms_log`, delivers nothing). **booking_confirmation** is wired into
  `book-appointment`. No real gateway yet; no email infra beyond Supabase Auth.
- **Work:** Add a real provider — create `_shared/sms/<provider>.ts` implementing
  `SmsProvider`, register it in `getSmsProvider`, and set `platform_config.sms_provider`
  (or the `SMS_PROVIDER` secret). Then wire the remaining message types: approval/rejection
  to customer, new-booking alert to admin, invitation delivery. Add an email provider
  (Resend/SendGrid). Backbone for reminders (#5).
- **Files:** `supabase/functions/_shared/sms/*`, `book-appointment`, status-change triggers,
  `sms_log`, `platform_config`, new `send-email`.

### 4. Auth/account safety — password reset & email change
- **Now:** Email/password login + account deletion exist. No **password reset** or
  **email change**.
- **Work:** "Forgot password" on `LoginPage` (`resetPasswordForEmail` + reset page) and
  email/password change in account settings. Low effort, high necessity.
- **Files:** `client/src/pages/auth/LoginPage.tsx`, `ProfileSettings.tsx` /
  new account settings section.

---

## P1 — Launch quality & retention

### 5. Appointment reminders (depends on #3)
Automated SMS/email N hours before an appointment — biggest no-show reducer. Add a pg_cron
job (pattern exists in migration 023) that enqueues reminders via send-sms/send-email.
Guard against duplicates (mirror migration 021).

### 6. Customer self-service cancel / reschedule
- **Now:** Only admins can cancel; no customer-facing flow.
- **Work:** Tokenized link in the confirmation message → page to cancel (and optionally
  reschedule into an open slot). Frees the slot + notifies the business. Reuse
  `computeAvailableSlots` in `client/src/lib/slots.ts`.

### 7. Customer email capture + confirmation emails
`customers` stores only name + phone. Add optional email to the booking form to enable
email confirmations/reminders and feed a future CRM.

### 8. Customer directory (lightweight CRM)
- **Now:** Customers only visible inline in appointments; no directory.
- **Work:** Customers list page (search, total visits, last visit, no-show count) + basic
  profile drawer with history. Data exists via `customers` ↔ `appointments` and
  `search_appointments` patterns.

---

## P2 — Growth, insight & polish

- **Business analytics:** revenue trends/charts, revenue by service & staff, no-show /
  cancellation rate, peak booking times. (Today: only week/month revenue totals.)
- **Data export:** CSV of appointments/customers.
- **Calendar UX:** day/month views, staff-filtered views, optional Google Calendar / iCal
  sync.
- **Per-staff schedules:** availability overrides per team member (today schedule is
  org-wide only).
- **Booking-page richness:** service descriptions/images, categories, staff bios.
- **Buffer time** between appointments in working-hours config.
- **Multi-language booking page** parity — confirm the public flow fully honors ka/ru/en.

---

## Recommended sequencing

1. **#4** password reset (small, removes an obvious launch gap).
2. **#3** notification delivery (unblocks reminders + confirmations).
3. **#1 + #2** payments (monetization gate — both launch-critical).
4. **#5–#8** reminders, self-service cancel/reschedule, email capture, CRM list.
5. **P2** analytics, exports, calendar/staff depth.
