# Record of processing activities — Article 28

Maintained under Article 28 of the Law of Georgia on Personal Data Protection.
**Must be producible to the Personal Data Protection Service within 3 working
days of a request.**

**Last reviewed:** 2026-08-20 · **Owner:** *[TO FILL — named person]*

> ⚠️ The controller identity fields below depend on `legalContent.ts`, which
> still contains `[COMPANY NAME]`, `[ID NUMBER]`, `[ADDRESS]`, `[EMAIL]`,
> `[DOMAIN]`. **Fill those first** — this record cannot be produced without them.

---

## 1. Controller and contacts

| | |
|---|---|
| Controller (account/platform data) | *[COMPANY NAME], ID [ID NUMBER], [ADDRESS]* |
| Contact for data-protection matters | *[EMAIL]* |
| Data Protection Officer | **Not appointed.** Art. 33 does not require one: not a listed sector (bank, insurer, telecom, airline, healthcare facility) and processing is not "large-scale". **Re-assess if health-sector businesses become a significant segment.** |

**Two roles, deliberately separated:**
- **Vis is the controller** of business-account data (owners, staff, billing).
- **Vis is the *processor*** of booking data — the business a client books with
  is the controller. Client rights requests go to that business; Vis assists.
  ⚠️ Art. 36 requires a written processing agreement with each business. **Not
  yet in place** — see `docs/COMPLIANCE_GE_DPL.md` G2.

## 2. Purposes and legal bases (Art. 5)

| Purpose | Basis |
|---|---|
| Creating and managing a booking | Contract performance (Art. 5(1)(b)) |
| Business account, billing, dunning | Contract performance; legal obligation (accounting) |
| Confirmation + morning-of reminder SMS | Contract performance — service messages, **not marketing** |
| Phone verification (OTP) | Contract performance; legitimate interest in preventing abuse |
| Blocking abusive numbers | Legitimate interest (Art. 5(1)(f)) — see §6 |
| Security, fraud and audit logging | Legitimate interest; legal obligation (Art. 27) |
| Booking-page view counts | No personal data processed — see §5 |

⚠️ **Open ambiguity:** the booking flow stores `consent_accepted_at` /
`consent_version` as though consent were the basis, while collecting it through
an inline "by continuing" notice that does not meet Art. 32. Either treat
bookings as contract (recommended, and stop calling it consent) or add a real
checkbox plus an Art. 20 withdrawal path. See G8.

## 3. Data subjects and categories

| Subject | Categories |
|---|---|
| Clients booking an appointment | Name, phone, appointment time/service, free-text notes, review text |
| Business owners / staff | Phone, email (often absent), display name, job title, photo |
| Concierge-onboarding enquirers | Phone, email, business name and address |

⚠️ **Special category (Art. 6):** `appointments.notes` is free text and health
providers use the platform (a dental clinic is registered). Notes at a clinic are
health data. No Art. 6 basis is currently documented — G7 is an open decision.

## 4. Recipients and processors

| Recipient | Role | Location |
|---|---|---|
| Supabase | Database, auth, storage, edge functions | **eu-west-1 (Ireland)** |
| Vercel | Frontend + edge hosting | EU/global edge |
| SMS provider | Message delivery | *[TO FILL — not yet live]* |
| Payment provider (BOG/TBC) | Card processing | Georgia — *[not yet live]* |

⚠️ **All personal data already leaves Georgia** (Supabase is in Ireland). The
transfer basis must be identified and the Supabase/Vercel DPAs executed — the
Privacy Policy already *asserts* both. See G3.

## 5. Retention (Art. 4(1)(e))

Enforced in code by `purge_expired_data()`, run nightly by the `purge-expired-data`
cron job. Tunable via `platform_config.retention_config`.

| Data | Rule |
|---|---|
| Appointments + linked customers | Anonymised after **24 months** |
| `sms_log` | Deleted after **12 months** |
| `notifications` (contains client names) | Deleted after **6 months** |
| `blocked_customers` | Deleted after **24 months** — a block expires |
| `setup_requests` (completed) | Deleted after **12 months** |
| `invitations` (accepted/expired) | Deleted after **30 days** |
| `reviews` | Author name scrubbed after **24 months**; rating + text kept as the business's reputation record |
| `pending_bookings` | Deleted after **7 days** |
| OTP challenges | Deleted **24h** after expiry |
| `booking_page_views` | **No personal data** — a per-org daily counter. No visitor id, IP or session token is ever sent to the server; "one visitor per day" is decided in the browser. Nothing to disclose, port or erase. |

**`org_members` is deliberately excluded from automatic purge.** Staff records
are controller-managed and deletable by the business in Team settings; a
time-based rule would delete active staff. Reviewed 2026-08-20.

## 6. Blocklist — documented legitimate interest

A business may block a phone number as a last resort against abuse. The refusal
is **silent** (the caller sees the same generic unavailability as any other) and
happens *before* an OTP is sent, so a blocked number cannot be used to pump SMS.

- **Basis:** legitimate interest in protecting the business from abusive or
  fraudulent booking behaviour, balanced against the individual's interest by
  (a) the block being per-business, never platform-wide, (b) automatic expiry at
  24 months, and (c) storing only a **peppered hash** of the number, so after an
  erasure request no readable number remains.
- **Decision (2026-08-20):** not to notify the blocked person, since doing so
  tells an abusive caller exactly which number to switch away from and invites
  confrontation with the business. The Privacy Policy discloses that businesses
  may block numbers.

## 7. Security measures (Art. 27)

Row-level tenant isolation on every table; hashed passwords and OTP codes;
peppered hashing of blocklist numbers; HTTPS throughout; least-privilege grants
(`anon`/`authenticated` hold no table-level rights on secret-bearing tables);
atomic OTP attempt budgets against brute force; append-only processing log.
Verified by adversarial testing on 2026-08-19 (`docs/COMPLIANCE_GE_DPL.md`).

### ⚠️ Known limitation of the processing log — accepted risk

`data_access_log` is **append-only** (no INSERT/UPDATE/DELETE policy exists, so
not even a superadmin can edit or erase it) and records the superadmin RPCs:
platform stats, org lists, billing/ops health, superadmin changes, client-data
erasure and appeal decisions.

**It does not capture a direct PostgREST table read.** A superadmin JWT can
still `GET /rest/v1/customers` and that access is recorded only in Supabase's
platform request log, whose retention is short.

- **Decided 2026-08-20:** accepted, on the basis that there is a single
  superadmin who is also the controller's principal.
- **Revisit when** a support team exists, or a third party is granted superadmin.
- **Closing it** means removing `is_superadmin()` from the RLS read policies on
  `customers`, `appointments`, `sms_log`, `booking_verifications` and
  `pending_bookings`, and routing support access through a logged RPC. Verified
  as feasible: no superadmin screen reads those tables today.

## 8. Data subject rights (Art. 13–20)

| Right | How it is served |
|---|---|
| Erasure (Art. 16) | `erase_customer_data` — Clients screen. Scrubs the customer row, appointment notes, their review, the SMS log identifier, parked bookings, and the readable blocklist number. |
| Information (Art. 13, 24) | Privacy Policy at `/privacy` |
| Access, rectification, portability, restriction, objection, withdrawal | **By request to the controller — no in-product self-service.** Not legally required, but the **10 working day** deadline applies. ⚠️ No named owner or inbox yet (G10). |
| Human review of automated decisions (Art. 19) | Billing suspension can be appealed from the blocked-dialog; an accepted appeal sets `billing_review_until`, which unblocks trading while it is considered. |

## 9. Incidents

Breach handling: see `docs/BREACH_RUNBOOK.md` (72h to the Service, Art. 29).

| Date | Summary | Reported? |
|---|---|---|
| — | No personal-data breaches recorded to date. | — |
