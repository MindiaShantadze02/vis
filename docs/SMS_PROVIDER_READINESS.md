# SMS Provider Readiness — how a real OTP provider slots into the current setup

_Assessment date: 2026-07-09. Written ahead of the payments + real-SMS launch phase._

## TL;DR

**The architecture is already provider-ready.** OTP SMS does **not** go through the DB-trigger
path — `request-booking-otp` and `request-password-reset` call `sendSms()` in-process
(`supabase/functions/_shared/sms/index.ts`), which resolves a provider via `buildProvider()`
(currently only `'mock'`; a commented `case 'smsoffice':` marks the extension point). Codes are
generated and SHA-256-hashed server-side (`_shared/otp.ts`), stored in `booking_verifications` /
`password_reset_verifications`, and never returned to the client.

Plugging in a real provider therefore requires **zero client changes and zero OTP-flow changes**:
implement the `SmsProvider` interface, register it in the factory, set config/secrets. Everything
else on the checklist below is launch hygiene (removing test backdoors, resetting relaxed limits).

## How the pieces fit today

```
                    ┌── in-process call (OTP path) ─────────────────────────┐
 client login /     │  request-booking-otp ─┐                               │
 register / booking │  request-password-reset ─┴→ sendSms() → SmsProvider ──┼→ (mock: console.log)
                    └───────────────────────────────────────────────────────┘
 DB triggers (booking confirmation / approval / 24h reminder)
   → pg_net POST platform_config.sms_config->send_sms_url  (x-sms-secret header)
   → send-sms edge fn → sendSms() → same SmsProvider
```

- **Provider selection precedence:** `SMS_PROVIDER` env var → `platform_config.sms_provider`
  column → `'mock'`. Unknown names **fail closed** (throw) — good; no silent mock fallback.
- **Logging:** every send writes an `sms_log` row (`queued` → `sent`/`failed` with
  `provider`, `provider_message_id`, `error`). `sendSms()` never throws — SMS stays a
  fire-and-forget side effect of booking.
- **Rate limiting:** `check_otp_rate_limit(phone, ip)` (migration 070) counts across both
  verification tables — `ip_burst 5/10min`, `ip_daily 20`, `phone_daily 6`, `global_daily 1000`
  (production defaults; the hosted project currently holds **relaxed** test values).

## Go-live checklist (mock → real provider)

### Code

1. **Create the provider** — `supabase/functions/_shared/sms/<provider>.ts` implementing
   `SmsProvider` (`_shared/sms/types.ts`).
   - ⚠ **Phone format:** `SmsMessage.to` arrives as a **bare 9-digit local number** (e.g.
     `555123456`). The provider's `send()` is responsible for prefixing `995`/`+995` in whatever
     format the gateway requires (design note in `types.ts`). For reference: `auth.users.phone`
     stores `995XXXXXXXXX` (no `+`), `customers.phone_number` stores bare local.
   - Map the gateway response to `SmsSendResult` (`sent`/`failed` + `providerMessageId`).
   - Candidate gateways named in code comments: SMSOffice, Magti, Geocell.
2. **Register it** in the `buildProvider()` switch (`_shared/sms/index.ts`) — replace the
   commented `case 'smsoffice':` stub.
3. **Redeploy** every function that bundles `_shared/sms/`: `send-sms`, `request-booking-otp`,
   `request-password-reset`.

### Config / secrets (hosted project)

4. Set `platform_config.sms_provider = '<name>'`; put gateway credentials in **function
   secrets** (mirroring the payments design — never in an org-readable column).
5. Verify `platform_config.sms_config` = `{ "send_sms_url": <deployed send-sms URL>,
   "webhook_secret": <SMS_WEBHOOK_SECRET> }`. If `send_sms_url` is NULL every DB-trigger SMS
   (confirmation / approval / reminder) silently no-ops; if the secret mismatches, they 401.
6. Confirm secrets exist for the functions: `SMS_WEBHOOK_SECRET`, `OTP_HASH_SECRET` (+ the new
   provider credentials).

### Remove the test backdoors

7. **Delete the `000000` OTP bypass** — `supabase/functions/verify-booking-otp/index.ts`:
   `TEST_OTP_CODE`, `testOtpBypassAllowed()`, and the bypass clause in the match check. Unset the
   `ALLOW_TEST_OTP` / `ALLOW_TEST_OTP_HOSTED` secrets and redeploy.
   - ⚠ **Consequence:** the Playwright e2e suite authenticates through `000000`
     (`client/e2e/helpers.ts` → `passAuthOtp`/`passBookingOtp`, `BOOKING_OTP`). Once removed,
     hosted e2e breaks. Mitigations (pick one when the time comes):
     a. keep the strict **localhost-only** gate (`ALLOW_TEST_OTP=true` + hostname allowlist)
        and run e2e against a local Supabase stack, or
     b. add a `test` SmsProvider that writes the code somewhere the runner can read
        (e.g. a service-role-only table), enabled only on a staging project.
8. **Reset the relaxed OTP rate limits** to production defaults:
   `UPDATE platform_config SET otp_rate_limits = DEFAULT WHERE id = 1;`
   (they were relaxed so e2e could hammer the same phones/IPs — migration 070 comment,
   `APP_OVERVIEW.md`).

### Verify (no code change expected)

9. **`reset-password` has no `000000` bypass** — the forgot-password flow is only fully
   testable once real SMS is live (until then, only via DB inspection). Budget a manual test.
10. **`sms_autoconfirm` stays off** — Supabase Auth `enable_confirmations=false` remains; the
    app layers its **own** OTP on top and never uses Supabase's built-in SMS. Adding a real
    provider changes nothing here.
11. **Templates** (`_shared/sms/templates.ts`): copy hardcodes the brand ("vis") and "10 minutes"
    expiry. Georgian text is Unicode ⇒ **70 chars per SMS segment** — check each template's
    segment count against gateway pricing before launch.
12. **Dormant dead code:** migrations 049/050 left `reservation_id`/`stay_id` triggers that POST
    to `send-sms`, but the function only resolves `appointment_id` (they would 400). Dead since
    059 (appointments-only). Flag for cleanup; not a launch blocker.
13. After switching, watch `sms_log` for `failed` rows and the provider dashboard for delivery
    receipts; the 60s resend cooldown and 10-min TTL need no tuning for a real gateway.
