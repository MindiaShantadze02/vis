# Security — blocking pre-launch checklist

Produced by the 2026-08-19 security sweep. Everything in **Part 1 is a live hole
that only stays acceptable while the platform has no real users.** They are all
deliberate testing affordances, not oversights — but every one of them must be
flipped before a single real customer books.

The audit's other findings were fixed in `20260823120000_security_hardening.sql`
and the accompanying edge/client changes; this file tracks only what is
knowingly left open.

---

## Part 1 — MUST be done before real users

### 1. `000000` accepts any phone (highest severity in the audit)
**Where:** `supabase/functions/verify-booking-otp/index.ts` — the
`ALLOW_TEST_OTP_HOSTED` branch inside `testOtpBypassAllowed()`.
**What it grants an attacker:** verify an OTP for a phone they do not own. That
verified challenge is the sole ownership proof for booking as that person and,
via `manage-appointment`, for **cancelling or rescheduling any booking whose UUID
they know**.
**To close:** unset `ALLOW_TEST_OTP` and `ALLOW_TEST_OTP_HOSTED` on the hosted
project, then delete the branch. Note `reset-password` deliberately has no such
bypass, so business logins are not exposed by this.
**Breaks when closed:** the entire Playwright suite and all manual booking
testing, until a real SMS provider is live. See `SMS_PROVIDER_READINESS.md`.

### 2. Unauthenticated "mark as paid"
**Where:** `supabase/functions/payment-webhook/index.ts`, the `provider === 'mock'`
branch — no signature, no secret.
**What it grants:** call `create-payment`, read `ref`/`id` out of the returned
checkout URL, POST them back with `outcome: 'paid'` ⇒ a real confirmed booking
for free, against any org, at scale.
**Partial guard already in place:** the branch refuses unless
`ALLOW_MOCK_PAYMENTS=true` **and** the active provider is still `mock`. So
selecting a real gateway closes it automatically — but only if
`platform_config.payment_provider` is actually set.
**To close:** unset `ALLOW_MOCK_PAYMENTS`, set `platform_config.payment_provider`
to the real gateway, and replace the static `PAYMENT_WEBHOOK_SECRET` check with
real per-provider signature verification of the raw callback body.

### 3. Rate limits are running at relaxed test values
`platform_config.otp_rate_limits` on the hosted project is 25–100× the
migration-070 defaults, because the e2e suite re-requests codes constantly.
**Reset to:** `ip_burst_count 5` / `ip_burst_minutes 10` / `ip_daily 20` /
`phone_daily 6` / `global_daily 1000`.
These caps are an **issuance** limit and are enforced on the request side only
(`request-booking-otp` / `request-password-reset`). They are deliberately not
consulted when verifying — see the note in `verify-booking-otp/index.ts`. Their
role against brute force is indirect but real: they bound how many fresh
challenges an attacker can have issued, and the per-phone 5-guess budget (which
a new code does not reset) bounds the guesses against each one. Resetting them
to the defaults above therefore tightens OTP brute force materially.

### 4. Leaked-password protection is off
Supabase dashboard → Auth → enable the HaveIBeenPwned check. Dashboard-only
setting, cannot be done from a migration.

---

## Part 2 — accepted residual risk (documented, not scheduled)

- **`services` is world-readable** (`services_public_select USING (true)`): every
  org's full price list, and ~100 inactive/unpublished services, are readable by
  anonymous callers. Deliberate — prices are on the public booking page anyway.
  Note `services.meeting_link` is in that set; it currently holds **0 rows**, but
  if anything ever writes it again it becomes a private-URL leak.
- **`has_verified_booking_otp` is anon-callable** and answers "is this phone
  mid-booking right now". It cannot be revoked: the `customers_insert` RLS policy
  calls it, and policy expressions are evaluated as the *calling* role, so
  removing the grant breaks all guest booking. Verified the hard way.
- **Cross-org booking spam:** `appointments_public_insert` is `WITH CHECK (true)`,
  so a caller can attribute a booking to any org — but it costs one verified OTP
  per row, which is exactly what booking through the UI costs. Equivalent to
  spam-booking, which the blocklist and manual-approval features already address.
- **Per-IP OTP caps assume `X-Forwarded-For`'s first hop is trustworthy.** Worth
  confirming against Supabase's gateway; if the platform appends rather than
  replaces, `ip_burst`/`ip_daily` are bypassable by rotating the header and only
  the per-phone and global caps remain.
