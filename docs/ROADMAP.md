# Vis — Feature Roadmap & Backlog

> Durable backlog for future sessions. The **core app is mature**; the opportunity is on the
> **"get & keep customers"** side (market analysis below), not more scheduling. Priorities:
> **P0** = launch blocking, **P1** = growth/retention (marketable), **P2** = polish.
> Last refreshed 2026-07-03.

## What's already done — DON'T re-plan these

Core booking (3-step: service → date/time/staff → details, phone-OTP guest booking, per-service
capacity), admin dashboard (overview + weekly calendar, search/filter, approve/reject/cancel),
services / working-hours / team (incl. non-login `staff` profiles), 3-step onboarding, multi-tenant
**RLS + tenant-isolation hardening (066)**, subscription tiers with usage enforcement, in-app
realtime notifications, i18n (ka/ru/en) **+ public language switcher**, superadmin tooling, account
deletion (+ storage cleanup), auto-complete cron.

**Shipped this session (2026-07):**
- **Data-protection compliance** (GE Law 3144): Privacy Policy + Terms (`docs/legal/`, `/privacy`,
  `/terms`), consent capture at booking/signup, retention purge + anonymization cron (064/065),
  Art. 16 erasure.
- **Security hardening (066):** role-escalation trigger, org-scoped `organisations` RLS (no
  cross-tenant secret reads), anon booking via SECURITY DEFINER RPCs (`get_public_org`,
  `get_booking_confirmation`, `get_org_busy_slots`).
- **Embeddable booking widget** (`?embed=1` bare mode, `embed.js` auto-height, payment-to-top) +
  copy-paste snippet + `frame-ancestors` headers.
- **Custom brand colour** for the booking page (067) on top of the 5 preset themes.
- **Phone-OTP auth + password reset** (038); online-payment + subscription-billing **plumbing**
  (`create-payment`/`payment-webhook`, mock gateway).

---

## Market context (drives P1 priorities)

Incumbents in Tbilisi (Fresha, Dikidi) sell on **acquisition + retention**, not scheduling:
discovery marketplace, online payments + **deposits/no-show protection**, automated reminders,
**loyalty/follow-ups**, **reviews**, waitlist. Georgia is unusually **payment-ready** (cards
ubiquitous, TBC/BOG apps everywhere) → online deposits are more marketable here than in cash-heavy
markets. Messaging leans **Viber/Telegram/FB Messenger**. Market is mobile-first & price-sensitive
(freemium fits). Vis is arguably **ahead** of incumbents on the branded **embeddable widget**.

---

## P0 — Launch blockers (need paid infra / legal entity)

### 1. Real payment gateway (BOG/TBC) — booking payments + subscription billing
- **Now:** `create-payment`/`payment-webhook` + `PaymentSettings` + `subscription_payments` exist
  but run against a **mock** gateway; the Subscription upgrade button and online booking payment are
  not wired to a real charge. Gated on the business's **legal/tax entity**.
- **Work:** wire live BOG/TBC (create charge → redirect → webhook → settle), implement
  `PaymentReturnPage`, handle failed/abandoned (release slot), at least manual refunds. Then remove
  the `ALLOW_MOCK_PAYMENTS` flag.

### 2. Real SMS delivery (unblocks reminders, review invites, self-cancel)
- **Now:** pluggable `_shared/sms/` layer with a **mock** provider; `dispatch_appointment_reminders`
  cron is built but no-ops without a real endpoint. Needs a paid gateway + sender-ID/ComCom
  compliance (user has **parked** the cost for now).
- **Work:** implement `_shared/sms/<provider>.ts` (e.g. smsoffice.ge), register in `getSmsProvider`,
  set `platform_config.sms_provider`; wire confirmation/approval/reminder message types. Then remove
  the `ALLOW_TEST_OTP` bypass. Later: Viber/Telegram as a GE differentiator.

---

## P1 — Growth & retention (most marketable; ordered)

Recommended order (marketability × effort × not-already-done), cheapest-first:

### 3. Reviews & ratings ⭐ next up — SPECCED (see below), no paid infra
Verified, appointment-bound reviews + a single owner on/off toggle. Cheapest high-marketability win
and a prerequisite for any future marketplace.

### 4. Loyalty / promo codes / referrals
Retention + IG/FB word-of-mouth; a referral link pairs with the shareable/embeddable page. Mostly
free to build. (Not yet specced.)

### 5. Online deposits / no-show protection (rides P0 #1)
The most *marketable* GE feature (card-ready market). **Keep the UX simple** — the user flagged that
a full deposit flow risks being too complex for non-tech-savvy owners; if built, minimize config
(one org-level % or fixed amount) and lean on "no-show protection" framing.

### 6. Appointment reminders (rides P0 #2)
Automated SMS N hours before — biggest no-show reducer; cron already built, just needs real SMS.

### 7. Customer self-service cancel / reschedule
Tokenized link (best via SMS) → cancel/reschedule into an open slot; frees the slot + notifies the
business. Reuse `computeAvailableSlots` (`client/src/lib/slots.ts`).

### 8. Customer email capture + directory (lightweight CRM)
`customers` holds only name + phone. Add optional email; a customers list (visits, last visit,
no-show count) + profile drawer. Feeds email confirmations and retention.

---

## P2 — Polish & bigger bets

- **Discovery marketplace / "Reserve with Google"** — Booksy's moat and the strongest acquisition
  play, but a high-effort two-sided bet; evaluate once reviews + a base of businesses exist.
- **Social/marketing quick wins:** QR code + WhatsApp/FB share for the booking link; rich **OG
  link-previews** for `/book/:slug` (Vercel edge fn injecting per-org name/logo — big for FB
  sharing); add-to-calendar (.ics) on the confirmation.
- **Analytics:** revenue trends/charts, by service/staff, no-show rate, peak times. **CSV export.**
- **Calendar UX:** day/month views, staff-filtered views, Google/iCal sync; per-staff schedules;
  buffer time.
- **Booking-page richness:** service descriptions/images, categories, staff bios, opening-hours +
  map on the public page.

---

## Specced & ready to build (decisions locked)

### A. Reviews & ratings (P1 #3)
- **Model:** each COMPLETED appointment's random UUID is a capability link `/review/:appointmentId`
  (same as `/booking-confirmation/:id`) → only a real attendee can review, one per appointment.
- **Owner control:** a single `organisations.reviews_enabled` on/off toggle (NOT per-review hiding —
  keeps the rating un-gameable). Gates both invites and public display.
- **Invite delivery v1 (no paid SMS):** owner copies a "review link" from the completed appointment
  (sends via their own Viber/WhatsApp) + a "Leave a review" CTA on the confirmation page after the
  visit. Auto-SMS is the later upgrade (reuse `dispatch_appointment_reminders`).
- **Public display:** ★ avg + count near the business name and a reviews list on `/book` (and in the
  embed) — via SECURITY DEFINER RPCs (extend `get_public_org` for avg/count; new `get_public_reviews`,
  `submit_review`), guarded by `reviews_enabled`.
- **Build:** migration `068_reviews.sql` (`reviews` table: org_id, appointment_id UNIQUE, rating
  1–5, comment, created_at; `organisations.reviews_enabled default true`); new
  `client/src/pages/review/ReviewPage.tsx` + route; owner toggle in `ProfileSettings`; "Copy review
  link" on completed appointments (`OverviewPage`/`CalendarPage`); ★ badge + section in
  `BookingShell`. Reuse `CopyableText`, `useToast`, the 066 definer-RPC pattern,
  `complete_elapsed_appointments`.

### B. Gate the embed widget to Pro & Business
- The embeddable widget suits established businesses with their own site → **Pro & Business only**
  (Pro is already the online-payment + team tier). App's **first feature-by-tier gate**.
- **Build:** add `tierAtLeast(current, target)` to `client/src/lib/tiers.ts` (via `TIER_KEYS`); in
  `OverviewPage` show the copy-embed block only for Pro+, else an upsell → Subscription page; add
  "Website embed widget" to Pro's `features` in `lib/tiers.ts` + i18n `tiers.pro.features`
  (en/ka/ru). Don't hard-block raw `?embed=1` (iframes can't be cheaply gated; the snippet is only
  surfaced to Pro+). Optional later: a "Powered by Vis" badge on non-Pro embeds.

---

## Recommended sequencing
1. **Reviews (A)** — cheap, no paid infra, sets up the trust layer. Bundle **embed-tier gating (B)**
   (tiny) alongside.
2. **Loyalty / referrals (P1 #4)** — cheap retention + IG/FB word-of-mouth.
3. **Real payments (P0 #1)** + **deposits (P1 #5)** once the legal entity is ready — most marketable
   for GE.
4. **Real SMS (P0 #2)** → **reminders (#6)** + **self-cancel (#7)** when the SMS cost is on the table.
5. **P2** — social/OG previews, analytics/export, calendar depth, and eventually the marketplace bet.
