# Compliance review — Law of Georgia on Personal Data Protection

**Law:** „პერსონალურ მონაცემთა დაცვის შესახებ", No. 3144-XIმს-Xმპ, adopted
14 June 2023, in force 3 July 2023 (as amended).
**Supervisory authority:** the Personal Data Protection Service (personaldata.ge).
**Reviewed:** 2026-08-20, against the live database and the shipped legal texts.

> This is an **engineering** review — what the code and data actually do, mapped
> to the statute. It is not legal advice. The judgement calls flagged below
> (controller/processor split, whether "large-scale" applies) should be
> confirmed by a Georgian data-protection lawyer before launch.

---

## What is already right

Worth stating first, because the foundation is genuinely good and most of the
gaps below are paperwork rather than architecture.

- **Controller/processor split is articulated correctly.** The Privacy Policy
  says Vis is the controller for account data and the *business's processor* for
  booking data, and directs client rights requests to the business. That is the
  right analysis for this product.
- **Article 27 security measures are real, not claimed.** Row-level tenant
  isolation on every table, hashed passwords and OTP codes, HTTPS, least
  privilege, secrets never shipped to the browser — all verified by attack
  testing in the 2026-08-19 sweep.
- **Article 4(1)(e) retention is implemented in code**, not just promised:
  `purge_expired_data` runs nightly and anonymises appointments/customers at 24
  months, deletes `sms_log` at 12 months, `pending_bookings` at 7 days and OTP
  challenges 24h after expiry — all tunable from `platform_config`.
- **Article 16 erasure exists as a product feature** (`erase_customer_data`,
  Clients page) rather than a manual DB job — though it is incomplete, see G5.
- **The view counter is privacy-by-design** (`booking_page_views`): a per-org
  daily counter with no visitor id, IP or session token, so there is nothing to
  disclose, port or erase. Keep new analytics to this shape.
- **The policy cites the right articles and the right regulator**, and commits
  to the 72-hour breach deadline.

---

## Blocking gaps

### G1 — The legal notices are unfinished placeholders (Art. 24, 13)
`client/src/pages/legal/legalContent.ts` still contains **`[COMPANY NAME]`,
`[ID NUMBER]`, `[ADDRESS]`, `[EMAIL]` (×4), `[DOMAIN]`, `[DATE]`**.

Article 24 requires the controller's identity and contact details to be given
**at or before collection**. Right now the notice literally cannot identify the
controller, and a data subject exercising Art. 13–16 rights has no address to
send the request to. Every downstream right depends on this.

**This is the single blocking item.** Everything else can be scheduled; this
cannot ship unfilled.

### G2 — Vis is a processor with no processing agreement (Art. 36)
The Privacy Policy declares Vis the businesses' processor for booking data.
Article 36 requires a **written agreement** with each controller covering:
processing only on documented instructions, staff confidentiality, security
measures, sub-processor consent, deletion/return on termination, and assistance
with compliance audits.

Terms §7 states the *business's* obligations but contains none of the processor
terms Vis owes **to** the business. There is no DPA.

**Fix:** add a "Data processing terms" section to the Terms (accepted at
sign-up, so it becomes the written agreement) covering all six Art. 36 points.

### G3 — The policy asserts safeguards that may not exist (Art. 36, 34)
Two published statements need to be true on launch day:

- *"Each acts as our processor under a data-processing agreement"* — requires
  the Supabase and Vercel DPAs to be **actually executed**, not merely offered.
- *"Where a processor is located outside Georgia, we apply the safeguards
  required for cross-border data transfer"* — the Supabase project is in
  **eu-west-1 (Ireland)**, so all personal data already leaves Georgia. The
  transfer mechanism must be identified and documented.

A published notice that overstates the safeguards is worse than a silent gap:
it is a misstatement to data subjects and the regulator.

---

## High

### G4 — No access logging anywhere (Art. 27, and Art. 36 instructions)
There is **no audit table in the database at all** (verified). Article 27
requires logging of processing actions.

This matters most for the superadmin flow. RLS grants superadmin read on
`customers`, `appointments`, `sms_log` (recipient phones), `reviews` and
`blocked_customers` **across every tenant**. The superadmin *UI* only surfaces
an org's own contact phone — but the credential can query all of it directly
through PostgREST, and nothing records who read what.

As Vis is the businesses' **processor**, a superadmin reading a tenant's client
list is processing outside the controller's documented instructions unless the
DPA authorises support access **and** it is logged.

**Fix:** an append-only `data_access_log` written by the superadmin-facing RPCs,
plus a support-access clause in the G2 agreement.

### G5 — "Erased" is not erased (Art. 16)
`erase_customer_data` updates **only** `appointments` (notes) and `customers`
(name/phone). Customer-identifying data it never touches:

| Left behind | Rows today | Retention |
|---|---|---|
| `sms_log.recipient_phone` | 4,783 | 12 months |
| `notifications.body` — contains the customer's **name** | 432 | **none** |
| `reviews.author_name` + `comment` | 0 | **none** |
| `blocked_customers.phone` | 1 | **none** |
| `pending_bookings.phone` | — | 7 days |

So a business honours an erasure request and the person's name and number remain
in several places, one of them forever. Article 16 also requires notifying third
parties the data was disclosed to.

### G6 — Tables with no retention rule (Art. 4(1)(e))
`purge_expired_data` covers six tables. It does not cover **`notifications`**
(customer names, 432 rows), **`reviews`**, **`blocked_customers`**,
**`setup_requests`** (phone, email, address), **`invitations`** (phone, email),
or **`org_members`** (staff names/photos, no leaver process). Data must be
deleted or anonymised once its purpose is met.

---

## Medium

### G7 — Special-category data in a free-text field (Art. 6)
`appointments.notes` is free text, and the platform is onboarding health
providers — a **dental clinic** is already registered. Appointment notes at a
clinic are health data, which Art. 6 permits only on narrow grounds including
**explicit written consent**.

Terms §7 disclaims this ("businesses must not enter special-category data
without proper grounds"), but Vis knowingly supplies the field to clinics. A
contractual disclaimer is unlikely to be sufficient on its own. Options: warn at
the point of entry for health-vertical orgs, or keep the disclaimer and document
the risk assessment deliberately.

### G8 — Consent basis is ambiguous (Art. 5, 32, 20)
The booking flow stores `consent_accepted_at` + `consent_version` as though
consent were the legal basis, but the UI is an **inline notice** — *"By
continuing, you agree…"* — which does not meet Art. 32's "freely and clearly
expressed" standard for consent. (Registration, by contrast, uses a real
unticked checkbox — correct there.)

For a booking, the natural basis is **contract performance, Art. 5(1)(b)**, and
no consent is needed at all. Pick one:
- **Contract** — keep the inline notice, stop calling the stored field consent.
- **Consent** — needs a real checkbox and an Art. 20 withdrawal path.

Claiming consent while collecting it implicitly is the one option that is wrong.

### G9 — No record of processing activities (Art. 28)
Must be maintained and producible to the regulator **within 3 working days**:
purposes, data subject and data categories, recipients, retention periods,
security measures, incidents. Nothing like it exists today. Most of the content
can be generated from this review.

### G10 — Rights machinery has no process behind it (Art. 13–18, 20)
There is no in-product path for access/copy (Art. 14), rectification (Art. 15),
portability (Art. 18) or consent withdrawal (Art. 20) — only erasure, and only
via the business. Self-service is **not** legally required, but the **10 working
day** deadline is, and there is currently no named owner, inbox or runbook.

### G11 — Breach response is promised but not operationalised (Art. 29–30)
The policy commits to notifying the regulator within 72 hours. There is no
runbook, no owner, no regulator contact on file, and no drafted subject notice.
72 hours is not long to invent all three.

### G12 — Blocked customers are never told (Art. 24, 4(1)(e))
`blocked_customers` stores a phone plus a free-text reason indefinitely, and the
person is refused before an OTP is even sent, with no indication why. Legitimate
interest is arguable, but it is undocumented and unretained.

---

## Automated decisions — needs a view (Art. 19)

Billing suspension is fully automated: miss the dunning window and
`billing_status` flips to `suspended`, which **blocks the business from taking
any bookings**. That is a decision by solely automated means with a clear
material effect. Art. 19 requires a human-review path, the right to express a
view, and the right to challenge.

Contract-necessity is a plausible justification, but the safeguards should exist
regardless — today there is no in-product appeal, only the pay-now button.

## Not applicable / low

- **DPO (Art. 33)** — likely **not required**: Vis is not in a listed sector
  (bank, insurer, telecom, airline, healthcare facility) and current volumes are
  not "large-scale". Re-assess as the platform grows, particularly if health
  providers become a significant segment.
- **Biometric (Art. 9), video/audio (Art. 10–11)** — none processed.
- **Direct marketing (Art. 12)** — no marketing messages are sent. The customer
  SMS policy is deliberately limited to a confirmation and a morning-of
  reminder, both service messages. Keep it that way, or Art. 12 consent applies.

---

## Suggested order

1. **G1** fill the placeholders — blocks launch, cheap.
2. **G3** execute the Supabase/Vercel DPAs and identify the transfer mechanism —
   makes already-published statements true.
3. **G2** processor terms into the Terms.
4. **G5 + G6** extend `erase_customer_data` and `purge_expired_data` — pure code,
   no legal input needed.
5. **G4** access logging.
6. **G9 + G11** processing record and breach runbook.
7. **G8, G7, G10, G12, Art. 19** — decisions to take, then implement.

Items 4 and 5 are the ones this codebase can fix by itself; the rest need a
decision or a lawyer first.
