# Pricing, Trial & Growth — Phased Implementation Plan

**Date:** 2026-07-09
**Input:** "Vis — Pricing, Trial & Growth: Decision Record" (2026-07-09) **plus Mindia's amendment: the Free tier is removed entirely** (no 5-appointments plan). Every new organisation gets a 30-day Starter-level trial, no card required; after that they must be on a paid plan.
**Status:** Plan only — nothing here is built or migrated yet.

---

## 0. Verified codebase facts (what the plan builds on)

| Assumption in the decision record | Reality in the repo |
|---|---|
| Central tier config | `platform_config.tier_limits` = `{"free":30,"starter":200,"pro":600,"business":null}`, `tier_prices` = `{"starter":15,"pro":40,"business":80}` (001_tables.sql:232-233). Prod matches — both need updating. |
| Enforcement in `org_can_accept_appointment` | Confirmed: BEFORE INSERT trigger `enforce_appointment_limit` (028) on `appointments` calls it; it reads `tier_limits ->> subscription_tier` (013). **Gotcha:** a tier key missing from the JSON reads as NULL = *unlimited*, so dropping the `free` key while orgs still have `subscription_tier='free'` silently grants them unlimited. The migration must convert orgs and config in one transaction. |
| Month boundary "calendar month Asia/Tbilisi" | **Not how it works.** Usage periods are rolling monthly windows anchored to `organisations.usage_anchor` (signup date, re-anchored on every tier change — 013 `current_period_start`). Per the record's own instruction ("keep it consistent"), the plan keeps the rolling anchor. |
| Cap counts approved+completed, excludes pending | **Current code differs:** `org_usage` counts everything except `rejected`/`cancelled` — i.e. *pending counts*. Enforcement happens at insert time, which is the only reliable point for direct client inserts. Recommendation: **keep counting pending** (deviating from §6). Excluding pending would mean the insert trigger can't block (a booking is always pending at insert), moving enforcement to approval time and letting requests pile up unbounded. Flagged for sign-off in §5. |
| Free tier had reminders off, default theme only | **Neither gate exists in code** — reminders (`dispatch_appointment_reminders`, 039) and all 7 themes are available to every org today. With Free gone, **theme gating never needs to be built** and reminder gating is only needed for *expired* orgs. |
| Bookable-staff limits per tier | No seat enforcement exists anywhere. Bookable staff = rows in `org_members` with the bookable flag (061 staff profiles). New enforcement needed. |
| Trial | No trial concept exists. `organisations.subscription_expires_at` exists and is set by the `payment-webhook` edge fn on paid subscription. |
| Pricing page with 3 cards | **No public pricing/marketing page exists in this repo.** The only pricing UI is the in-app `SubscriptionPage.tsx`. The public pricing page presumably belongs to a (future) marketing site. Plan covers the in-app page; flagged in §5. |
| Cypress coverage | Repo tests are **Playwright e2e** (incl. data-driven BVA rows in `e2e/data/*.json`) + **Vitest** unit layer. Plan uses those. |
| Existing orgs | Prod: 6 orgs on `free` (test businesses), 1 on `business`. Migration converts `free` orgs to a fresh 30-day Starter trial. |

---

## 1. Target model (with the Free tier removed)

### Plans
| Tier | Price | Appointments/mo | Bookable staff | Reminders | Themes |
|---|---|---|---|---|---|
| Starter | ₾29/mo | 150 | 1 | ✅ | all 7 |
| Pro (highlighted) | ₾59/mo | 400 | 3 | ✅ | all 7 |
| Business | ₾99/mo | 800 (see §5.7) | unlimited | ✅ | all 7 |

`'free'` is removed from the `subscription_tier` CHECK constraint, `tier_limits`, `client/src/lib/tiers.ts`, and all i18n strings. Business stays out of the self-serve cards — one quiet „დიდი გუნდისთვის — მოგვწერეთ" contact line; assigned by superadmin only.

### Subscription state (derived, not stored)
No status column and **no expiry cron**. State is computed from two timestamps:

```
trial   := subscription_expires_at IS NULL AND trial_ends_at > now()
active  := subscription_expires_at > now()          -- paid, current
expired := otherwise                                 -- trial over & unpaid, or paid sub lapsed
```

- New org ⇒ `subscription_tier='starter'`, `trial_ends_at = now() + 30 days` (Starter-level trial: 150 cap, reminders on, all themes).
- Paying (payment-webhook already sets `subscription_tier` + `subscription_expires_at`) naturally moves the org to `active` — no extra trial-end handling.
- A lapsed paid subscription lands in the same `expired` state as a lapsed trial — one code path.

### Expired state semantics (replaces "downgrade to Free") — **needs Mindia's sign-off, see §5.1**
- Organisation is **never disabled**: dashboard fully accessible, all data intact, booking page stays live.
- New bookings blocked: `org_can_accept_appointment` returns false ⇒ existing `atCapacity` path in `BookingLayout` shows the neutral, dignified message (customer never sees "unpaid").
- Owner-created appointments blocked by the same trigger (otherwise the cap is bypassable).
- Day-before reminders stop (`dispatch_appointment_reminders` skips expired orgs). OTP + confirmations for *already-booked* appointments still send.
- Persistent (non-dismissible) "choose a plan" banner in the dashboard.

---

## 2. Phase 1 — launch-blocking

### 2.1 Migration `072_pricing_trial.sql`
One transaction, ordered to avoid the NULL-limit-=-unlimited gotcha:

1. `ALTER TABLE organisations ADD COLUMN trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');`
   Comment: start of every org's life; state is derived, never flipped by a job.
2. Backfill: existing `free` orgs → `subscription_tier='starter'`, `trial_ends_at = now() + interval '30 days'` (fresh trial; they're test accounts). `business` org: `trial_ends_at = created_at` (irrelevant once `subscription_expires_at` is maintained — set it far-future for the superadmin-assigned org, or rely on §2.1.6).
3. Replace the CHECK constraint: `subscription_tier IN ('starter','pro','business')`; `ALTER COLUMN subscription_tier SET DEFAULT 'starter'`.
4. `UPDATE platform_config SET tier_limits = '{"starter":150,"pro":400,"business":800}', tier_prices = '{"starter":29,"pro":59,"business":99}';` plus new `tier_staff_limits jsonb DEFAULT '{"starter":1,"pro":3,"business":null}'`.
5. New `org_subscription_state(p_org_id) RETURNS text` (SECURITY DEFINER, STABLE) implementing §1. **Superadmin-assigned paid orgs need `subscription_expires_at` set** (manual assignment = superadmin also sets an expiry, or NULL-expiry+tier-set counts as active — decide in implementation; recommendation: treat a superadmin tier change as setting `subscription_expires_at` explicitly so there's exactly one meaning of "active").
6. `org_can_accept_appointment`: `expired ⇒ false`, else existing limit check unchanged. Keep the "missing org ⇒ true" trigger contract from 028.
7. `org_usage_info`: add `state text` and `trial_ends_at` to the return table (SubscriptionPage/banner get everything in one RPC; keep the 066 member/superadmin gate).
8. `dispatch_appointment_reminders`: add `AND org_subscription_state(a.org_id) <> 'expired'` to the candidate scan.
9. Staff seats: BEFORE INSERT/UPDATE trigger on `org_members` — when the row is (becoming) bookable and the org's bookable count ≥ `tier_staff_limits ->> tier`, `RAISE EXCEPTION 'staff_limit_reached'`. NULL limit = unlimited. Trial orgs get Starter's limit (1) — §5.2. (Verify exact bookable column name in 061 during implementation.)

### 2.2 Edge functions
- `create-payment`: no structural change (`VALID_TIERS` already excludes free; prices come from `tier_prices`). Add the founders'-deal hook point later (Phase 2).
- `payment-webhook`: already flips tier + `subscription_expires_at` — confirm it satisfies §2.1.5's definition of `active`. Redeploy anything whose bundled SQL/types mention `free`.
- `api` edge fn (071): `api_create_booking` inserts hit the same trigger — verify its error mapping surfaces `limit_reached` cleanly as 4xx (it should already).

### 2.3 Client
- **`lib/tiers.ts` rewrite:** drop `free`; `Tier = 'starter'|'pro'|'business'`; limits 150/400/800; prices ₾29/₾59/₾99; features per the record (reminders sell Starter, staff seats sell Pro); Pro gets the highlighted/recommended treatment. `tierAtLeast` keeps working with the shorter order (currently unused but exported). Update `tiers.test.ts` + i18n `tiers.*` keys (ka/en).
- **`OrgContext`:** expose `subscriptionState` + `trialEndsAt` (from `org_usage_info` or the org row) so banners/gates don't each re-fetch.
- **SubscriptionPage:** 2 self-serve cards (Starter / Pro-highlighted) + quiet Business contact line; current-plan card shows trial state ("Starter trial — ends d MMMM"); remove the `tier.key !== 'free'` special-case. Existing usage bar + 80% warning + limit-reached copy stay (new caps arrive via config).
- **Trial countdown banner:** dashboard-level, shown when `state==='trial'` and ≤7 days left — "Starter trial ends in N days — choose a plan to keep reminders on." Links to SubscriptionPage.
- **Expiry notification (exactly one, in-app):** shown when `state==='expired'`; dismissible *once* into a slim persistent "choose a plan" strip. Persist dismissal in a small org column (`trial_expiry_ack_at`) — no notifications table needed.
- **Cap-hit / expired UX (public booking):** `BookingLayout` already pre-checks `org_can_accept_appointment` → `atCapacity`; `Step3CustomerForm` + `AddAppointmentDialog` already map `limit_reached`. Reword the customer-facing copy to the neutral, dignified version (ka/en); the owner-side `AddAppointmentDialog` error gets an upgrade CTA. Handle `staff_limit_reached` in the staff-management UI with an upgrade CTA.
- **Usage meter on dashboard home:** compact "43 / 150" element reusing `org_usage_info` (SubscriptionPage already has the full bar).
- **Onboarding checklist card:** add service → set hours → staff photo → "Put your booking link in your Instagram bio" (copy-link). First three derivable from data; persist the final step + dismissal (org jsonb column or the same ack pattern).
- **"Powered by Vis" footer:** small link on the public booking page, rendered in all 7 themes + embed mode; must not fight the org's brand.
- **i18n:** every new string in ka + en; ₾ formatted consistently.

### 2.4 Tests
- **Vitest:** tiers.ts (order, lookup, fallback — note `tierInfo` fallback is currently `TIERS[0]` = free; becomes starter), state-derivation helpers if any land client-side.
- **Playwright:** trial org books normally; expired org → booking page shows neutral block, dashboard shows plan strip; owner insert blocked when expired; staff seat limit on Starter; 80%/100% meter states. **Update `e2e/data/*.json` BVA rows for the 150/400/800 boundaries** (not inline literals) and let `consistency.spec` verify sync.
- Full `cd client && npx playwright test` before calling any step done.

---

## 3. Phase 2

1. **ROI widget** (Starter/Pro/trial dashboards): "This month: X reminders sent → ~Y no-shows prevented → ~₾Z saved."
   - X: count `appointments.reminder_sent_at` in the current usage period (new small RPC).
   - `Y = X × PREVENTION_RATE` (`platform_config.prevention_rate numeric DEFAULT 0.15`).
   - `Z = Y × avg(price)` of the org's *completed* appointments this period, fallback avg listed service price. **PostgREST returns numerics as strings — coerce with `Number()`.**
   - Copy says "estimated" (ka/en) — wording sign-off is §5.6.
2. **Founders' deal:** `organisations.founder_discount boolean DEFAULT false` + `platform_config.founder_slots_total int DEFAULT 100`; claimed count = `count(*) WHERE founder_discount`. Auto-claim on first paid checkout while slots remain (or manual superadmin flag — §5.3). `create-payment` applies ~30% (₾19/₾39) server-side; list prices unchanged everywhere public.
3. **Annual surface:** show the 10-months offer (₾290/₾590) in SubscriptionPage only after the org's 2nd successful paid month — derive from the subscription-payments history `create-payment`/`payment-webhook` already record (verify table shape at build time). Never at signup.

## 4. Phase 3 — referrals

`referrals` table (code, referrer_org, referee_org, status, created/activated timestamps), unique referral code per org, redemption at onboarding, activation = **first booking received** (recommended precise definition — §5.4), reward = +1 month on both sides via `subscription_expires_at`/`trial_ends_at` extension, anti-abuse (self-referral, duplicate owner phone), Instagram-story share image template. Full schema design deferred until §5.4 is answered.

---

## 5. Decisions — RESOLVED with Mindia (2026-07-09), Phase 1 BUILT

1. **Expired-state semantics — DECIDED: block new bookings only.** Dashboard, data and the booking page stay alive forever; only new bookings are blocked (existing neutral "not accepting bookings" copy, same for cap-hit) and day-before reminders stop; persistent "choose a plan" strip in the dashboard. Implemented in migration 072 (`org_subscription_state`, derived from timestamps — no cron) + `SubscriptionBanner`.
2. **Trial staff seats — DECIDED: hard limit of 1** (it's exactly a Starter trial). `enforce_staff_limit` trigger + `tier_staff_limits` config (starter 1 / pro 3 / business unlimited); friendly upgrade prompt in TeamSettings.
3. **Billing rails — DECIDED: the existing create-payment → payment-webhook self-serve flow is the launch rail** (pluggable provider: mock in dev, real BOG/TBC once merchant creds land — see payments architecture docs). Superadmin manual assignment also works and now sets `subscription_expires_at` (+30 days) so "active" has one meaning.
4. **Cap semantics — DECIDED: keep counting pending at insert time** (deviation from record §6 accepted; excluding pending would break insert-time enforcement and allow unbounded request pile-up).
5. **Referral activation definition + stacking** — still open, Phase 3 gate.
6. **PREVENTION_RATE 0.15 + ka/en "estimated" wording** — still open, Phase 2 gate.
7. **Business cap:** set to 800 (was unlimited); per-org override deferred until a real "custom" deal exists.
8. **Public pricing page:** still lives outside this repo; the in-app SubscriptionPage carries the 2-cards-plus-Business-contact-line layout.

### Also shipped in Phase 1 (found during implementation)
- **Owner self-upgrade hole closed:** the `organisations` UPDATE policy let an owner set their own `subscription_tier`/`subscription_expires_at` (and would have let them extend `trial_ends_at`) via PostgREST. Migration 072's `prevent_billing_self_update` trigger restricts those columns to superadmins and service-role contexts.
- **e2e stability:** the seed org ("Test Appointments Studio") is pinned to an active paid starter state (far-future expiry) so the suite doesn't rot when a 30-day trial lapses; trial coverage comes from the onboarding spec (fresh orgs are trials) and Vitest state-derivation tests; expired-state logic is covered by SQL smoke tests (UI can't manufacture it — the billing guard blocks it, by design).
- i18n shipped in **ka + en + ru** (the app has three locales, not two).
