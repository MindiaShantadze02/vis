# Multi-Vertical — Remaining Work & Temporary Flags

Status as of the multi-vertical build (verticals: **appointments** (original),
**restaurant**, **hotel**). All three are functional end-to-end: onboarding →
settings → public booking (with OTP) → owner bell notification (+ customer
confirmation SMS when SMS is configured) → dashboard to approve/manage.

DB migrations **044–053** are live on the project `dnmecnpugjxkjonqsfxx`, plus
redeploys of the `send-sms`, `verify-booking-otp`, `create-payment`, and
`payment-webhook` edge functions.

---

## ✅ Round 2 — DEPLOYED (migrations 051–053 + create-payment/payment-webhook)

All three approved items are implemented, validated, and **live** on
`dnmecnpugjxkjonqsfxx` (migrations 044–053 synced; create-payment + payment-webhook
redeployed with the new `stay` branch). What they do:
- **Unified metering (051):** reservations + stays now count toward the monthly tier
  limit (extends `org_usage`; reuses `enforce_appointment_limit` as a trigger on both
  new tables).
- **Configurable turn time (052):** `organisations.reservation_turn_minutes` (default
  120), surfaced in restaurant Tables settings and read by the booking flow + the public
  `get_public_org` RPC.
- **Hotel full prepay (053 + edge fns):** when a hotel enables online payment, the guest
  prepays the full stay; `create-payment`/`payment-webhook` gain a `stay` purpose +
  `pending_stays` table (mirrors the appointment online flow). Pay-at-desk unchanged.

---

## ⚠️ TEMPORARY — must be undone before real launch

### OTP test bypass is ENABLED on the hosted project
To test bookings without an SMS provider, the `'000000'` OTP bypass in
`supabase/functions/verify-booking-otp/index.ts` has been opened on the hosted
project via secrets:

- `ALLOW_TEST_OTP=true`
- `ALLOW_TEST_OTP_HOSTED=true`  ← re-opens the bypass the 2026-06-24 security
  review had closed (normally local-host only).

**How to test:** in any booking flow enter the code **`000000`** at the SMS step.

**To revert when SMS goes live:**
1. `supabase secrets unset ALLOW_TEST_OTP_HOSTED ALLOW_TEST_OTP --project-ref dnmecnpugjxkjonqsfxx`
2. Delete the `ALLOW_TEST_OTP_HOSTED` branch in `verify-booking-otp/index.ts`
   (restore the strict local-host-only gate).
3. Redeploy: `supabase functions deploy verify-booking-otp --project-ref dnmecnpugjxkjonqsfxx --use-api --no-verify-jwt`
4. Configure a real SMS provider (`platform_config.sms_provider` + `sms_config`,
   function secrets) so codes are actually delivered.

### Mock payments are ENABLED on the hosted project
`ALLOW_MOCK_PAYMENTS=true` is set so the `/pay/mock` gateway can settle payments
(needed to test hotel prepay end-to-end). This lets the **unauthenticated** mock
webhook flip rows to paid — a backdoor, same caution as the OTP bypass.

**To revert before real launch:**
1. `supabase secrets unset ALLOW_MOCK_PAYMENTS --project-ref dnmecnpugjxkjonqsfxx`
2. Remove the `mock` branch in `payment-webhook/index.ts` (or fold it behind a real
   gateway signature) and wire a real provider (BOG/TBC) in `_shared/payments/`.

---

## Remaining feature work (optional / deferred)

### Hotels
- **Deposits / multi-night prepay** and card hold (deferred per plan §2.4).
- **Overbooking allowance** per room type (currently strict: occupied < `total_rooms`).
- **Cancellation-window policy** (e.g. non-refundable < N days) + partial refunds
  (`payment_status` is binary today).
- **Individual-room** granularity (currently room-*type* only — `resources.kind='room_type'`
  with `attrs.{nightly_price,total_rooms}`; no per-room assignment / room numbers).
- Optional **per-night inventory calendar** table if per-date pricing/closures are needed
  (today availability is computed from overlapping stays vs `total_rooms`).

### Restaurants
- **Deposits / no-show prepayment** to hold a table (deferred per plan §2.4).
- **Turn time & slot granularity** are fixed (120 / 30 min) — make per-org / per-party-size.
- **Walk-ins** UI (a same-day in-person reservation entry for staff).

### All new verticals
- ✅ **DONE — `approval_update` SMS** when an owner approves a reservation/stay
  (migration 050; the new-booking SMS was moved from insert→approval to match
  appointments). The insert-time owner bell notification stays.
- ✅ **DONE — admin manual entry** (`AddReservationDialog` / `AddStayDialog`,
  reached via the "+" button on each dashboard; admin inserts are OTP-exempt and
  created as `approved`).
- **Subscription limits** don't count reservations/stays (`org_can_accept_appointment`
  only counts the `appointments` table). Decide if/how non-appointment verticals
  should be metered. *(Needs a product decision.)*

### Cross-cutting
- **Regression suite**: run `npm run test:e2e` (Cypress) to confirm the appointment
  flow still passes, and add restaurant/hotel specs. Cypress could not be run in the
  build environment used for this work, so the suite has not been executed against
  these changes — typecheck is green and changes are vertical-gated/additive.
- **No CI** (per earlier decision) — run the suite manually before merges.

---

## Architecture quick-reference (for picking this back up)

- **Vertical scoping:** `organisations.vertical` (`appointments|restaurant|hotel`,
  immutable trigger, migration 044). Frontend single source of truth:
  `client/src/lib/verticals/` (`useVertical()`, `VERTICAL_CONFIGS` with
  `settingsNav` + `showCalendar`).
- **Shared core + per-vertical tables:** `resources` (kind `table`/`room_type`),
  `restaurant_reservations`, `hotel_stays`. `appointments` is untouched.
- **Vertical branches:** `BookingLayout` (public), `OverviewPage` (dashboard),
  `DashboardLayout` (nav), onboarding `BusinessProfileStep` + `OnboardingLayout`
  (`stepsFor`).
- **Pure availability:** `lib/restaurantSlots.ts`, `lib/hotelInventory.ts`.
- **OTP/notify/SMS reuse:** `enforce_booking_verification` (047/048),
  `notify_new_*` + `send_*_sms` (049), `send-sms` resolves
  `appointment_id|reservation_id|stay_id`.
