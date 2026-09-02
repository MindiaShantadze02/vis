# Vis — Architecture

> Visual companion to [APP_OVERVIEW.md](APP_OVERVIEW.md). That document explains **what** each
> part does and why; this one shows **how the parts connect**. Where a section needs prose detail
> it links there rather than repeating it.
>
> **Verified against the live project** `dnmecnpugjxkjonqsfxx` on **2026-08-31** — tables, edge
> functions, cron jobs and triggers below were read from the running database and the deployed
> function list, not reconstructed from migrations.
>
> Note: [`supabase/README.md`](../supabase/README.md) is stale (it still describes `slots`,
> `subscription_payments` and a `receipts` bucket, none of which exist). Trust this file over it.

**Contents**
1. [What the app does](#1-what-the-app-does) — the functional map
2. [System context](#2-system-context)
3. [Client structure](#3-client-structure)
4. [Edge functions and their callers](#4-edge-functions-and-their-callers)
5. [Database](#5-database) — [tenancy & booking](#5a-tenancy-catalog-and-booking) · [billing](#5b-billing-and-payments) · [comms, compliance, platform](#5c-comms-compliance-and-platform)
6. [Guest booking, end to end](#6-guest-booking-end-to-end)
7. [Async work — cron and triggers](#7-async-work--cron-and-triggers)

---

## 1. What the app does

Before the wiring: the product surface, grouped by **who it serves**. Everything drawn here is
built and shipped. Two capabilities are conditional rather than universal — phone verification and
outgoing SMS only happen for a business that has bought the SMS add-on, which is off by default,
and manual approval is opt-in and applies to on-site bookings only.

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TB
  subgraph CUST["FOR THE CUSTOMER — no account, a phone number is enough"]
    direction LR
    c1["<b>Find the business</b><br/>branded booking page<br/>embeddable on their own site<br/>Georgian · Russian · English<br/>reviews and photos on show"]
    c2["<b>Choose and schedule</b><br/>service catalog with prices<br/>pick a specific staff member<br/>live availability only"]
    c3["<b>Confirm and pay</b><br/>phone code when the business<br/>has the SMS add-on<br/>online · on site · deposit"]
    c1 ~~~ c2 ~~~ c3 ~~~ c4
    c4["<b>Afterwards</b><br/>confirmation and reminder<br/>reschedule or cancel<br/>leave a review once done"]
  end

  subgraph BIZ["FOR THE BUSINESS — the owner and their staff"]
    direction LR
    b1["<b>Set up shop</b><br/>guided four-step onboarding<br/>services, photos, prices<br/>weekly hours and holidays<br/>team, invites, staff profiles<br/>booking-page branding"]
    b2["<b>Control intake</b><br/>auto-approve or hold for review<br/>capacity per slot<br/>how far ahead people may book<br/>cancellation window<br/>block a nuisance number"]
    b3["<b>Run the day</b><br/>calendar and day view<br/>approve, complete, no-show<br/>cancel, reassign staff<br/>rest periods, own bookings<br/>send a meeting link"]
    b4["<b>Handle money</b><br/>take payment or a deposit<br/>refund in full or part<br/>card on file for the Vis bill<br/>monthly invoice, appeal it"]
    b1 ~~~ b2 ~~~ b3 ~~~ b4 ~~~ b5
    b5["<b>Follow up and learn</b><br/>confirmation and reminder SMS<br/>in-app notifications<br/>revenue, repeat and no-show rates<br/>busiest days and hours<br/>booking-page visits"]
  end

  subgraph PLAT["FOR THE PLATFORM — Vis staff"]
    direction LR
    p1["<b>Oversee businesses</b><br/>browse and search orgs<br/>per-org detail and usage"]
    p2["<b>Keep the money right</b><br/>billing health across the platform<br/>decide billing appeals"]
    p1 ~~~ p2 ~~~ p3
    p3["<b>Help and monitor</b><br/>set an account up on request<br/>system and ops health"]
  end

  subgraph TRUST["ACROSS EVERYTHING — trust and obligations"]
    direction LR
    t1["<b>Consent</b><br/>captured and versioned<br/>privacy policy and terms"]
    t2["<b>Erasure and retention</b><br/>wipe a customer on request<br/>old data ages out nightly"]
    t3["<b>Accountability</b><br/>append-only access log<br/>refund and message trails"]
    t1 ~~~ t2 ~~~ t3 ~~~ t4
    t4["<b>Abuse control</b><br/>per-org blocklist<br/>caps on code requests"]
  end

  CUST ~~~ BIZ ~~~ PLAT ~~~ TRUST
```

**Worth knowing**

- The customer never makes an account. A booking needs a name and a phone number, and the same
  phone is what later proves identity for a reschedule, a cancellation or a review.
- **Bookings are not owner-only or customer-only.** Most arrive through the public page, but the
  owner can also add one from the calendar; the two are distinguished at insert by
  `appointments.source`, because they bill differently.
- Money moves in two independent directions: the **customer pays the business** for an appointment,
  and separately the **business pays Vis** a monthly post-paid bill. They share a payment provider
  seam but nothing else — see §5b.
- What is *not* here, by design: no marketplace or cross-business search, no customer accounts or
  loyalty scheme, no recurring appointments, no public REST API. Several of these existed once and
  were deliberately removed; see [APP_OVERVIEW.md](APP_OVERVIEW.md) for that history.

---

## 2. System context

Two facts shape everything below. First, **there is no separate application server** — the React
SPA talks straight to Supabase, and all server-side logic lives either in Postgres (RLS, SECURITY
DEFINER RPCs, triggers) or in Deno edge functions. Second, **both external providers are `mock` in
production today**: `bog.ts` / `tbc.ts` and the `smsoffice` SMS case are stubs that throw
`provider_not_configured`, and the factory fails closed on an unknown provider name.

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart LR
  subgraph actors["People"]
    guest["Guest customer<br/>no account, phone only"]
    owner["Owner / staff<br/>phone + password"]
    sa["Superadmin"]
  end

  subgraph vercel["Vercel — static + edge"]
    spa["React 19 SPA<br/>Vite · MUI · react-router"]
    bookmeta["api/book-meta.ts<br/>per-org OG + JSON-LD"]
    sitemapfn["api/sitemap.ts"]
    embedjs["embed.js<br/>iframe auto-resize"]
  end

  subgraph sb["Supabase — the entire backend"]
    auth["Auth<br/>phone + password"]
    rest["PostgREST<br/>RLS-enforced tables"]
    rpcs["SECURITY DEFINER RPCs"]
    fns["Edge Functions<br/>Deno · 11 live"]
    pg[("Postgres 17<br/>28 tables")]
    store["Storage<br/>3 live buckets"]
    rt["Realtime"]
    cron["pg_cron + pg_net"]
  end

  subgraph ext["External services"]
    smsp["SMS provider<br/>MOCK — stub only"]
    payp["Payment gateway<br/>MOCK — BOG/TBC stubbed"]
    sentry["Sentry<br/>no-op without DSN"]
  end

  guest -->|"/book/:slug"| bookmeta
  bookmeta -->|"rewrites SEO block, serves shell"| spa
  guest --> spa
  owner -->|"/dashboard"| spa
  sa -->|"/superadmin"| spa
  embedjs -.->|"third-party site embeds /book"| spa

  spa --> auth
  spa --> rest
  spa --> rpcs
  spa --> fns
  spa --> store
  spa --> sentry
  rt -->|"notification bell"| spa

  bookmeta -->|"anon RPC"| rpcs
  sitemapfn -->|"anon RPC"| rpcs

  rest --> pg
  rpcs --> pg
  auth --> pg
  fns --> pg
  pg --> rt
  cron --> pg
  cron -.->|"pg_net calls back out"| fns

  fns --> smsp
  fns --> payp
  payp -.->|"webhook callback"| fns

  classDef mock stroke-dasharray:5 3
  class smsp,payp mock
```

**Worth knowing**

- The database calls the edge functions *back out* over HTTP via `pg_net` — the `cron -.-> fns`
  edge is not decoration. SMS is dispatched by a trigger, not by the client.
- `/book/:slug` is served by a Vercel edge function that rewrites an SEO block inside the SPA
  shell, so the public booking page is crawlable. It falls back to the untouched shell on any
  Supabase error and only 404s on a confirmed-missing org.
- `frame-ancestors *` is set for `/book/*` only, because that route is embeddable; everything else
  is `'self'` plus `X-Frame-Options`. See `client/vercel.json`.

---

## 3. Client structure

Four guards over six route groups. The useful part of this diagram is the **right-hand column**:
which backend access path each group uses. Most dashboard reads are plain PostgREST against
RLS-protected tables; anything crossing a tenant boundary, touching money, or needing to run as a
privileged role goes through an RPC or an edge function instead.

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TB
  subgraph providers["Provider stack — main.tsx"]
    direction LR
    p1["I18nextProvider<br/>ka default · ru · en"] --> p2["ThemeProvider<br/>MUI + booking themes"] --> p3["ToastProvider"] --> p4["BrowserRouter"] --> p5["AuthProvider<br/>session, user"] --> p6["OrgProvider<br/>org, role, billing"]
  end

  subgraph guards["Guards — App.tsx"]
    direction LR
    g1["AuthGuard"]
    g2["OrgGuard"]
    g3["SuperAdminGuard"]
    g4["PublicOnlyGuard"]
  end

  subgraph routes["Route groups — all React.lazy"]
    r1["Public + legal<br/>/ · /privacy · /terms · /docs/widget"]
    r2["Auth<br/>/login · /register · /forgot-password"]
    r3["Onboarding<br/>/onboarding/business|services|specialists|hours"]
    r4["Dashboard<br/>/dashboard + /dashboard/settings/*"]
    r5["Booking + guest flow<br/>/book/:slug · /manage/:id · /review/:id"]
    r6["Superadmin<br/>/superadmin/*"]
  end

  subgraph access["Backend access paths"]
    a1["PostgREST .from<br/>RLS-enforced"]
    a2["RPC .rpc<br/>SECURITY DEFINER"]
    a3["functions.invoke<br/>edge functions"]
    a4["Realtime channel"]
    a5["Storage upload"]
  end

  providers --> guards
  g4 --> r2
  g1 --> r3
  g1 --> g2
  g2 --> r4
  g1 --> g3
  g3 --> r6

  r2 --> a3
  r3 --> a1
  r3 --> a5
  r4 --> a1
  r4 --> a2
  r4 --> a3
  r4 --> a4
  r4 --> a5
  r5 --> a2
  r5 --> a3
  r6 --> a2
  r1 --> a2
```

**Worth knowing**

- [`client/src/lib/supabase.ts`](../client/src/lib/supabase.ts) creates **two** clients. The second
  is a throwaway with `persistSession: false` and its own `storageKey`, used only by
  `checkCredentials()` so the login password pre-check does not mint a session before the OTP step
  has passed.
- **Realtime is used in exactly one place** — [`useNotifications.ts`](../client/src/hooks/useNotifications.ts),
  channel `notifications:${user.id}`. Nothing else subscribes.
- Superadmin pages never read tenant tables directly; every one of them goes through a
  `platform_*` / `list_*` RPC that also writes to `data_access_log`.
- Tables the client touches directly: `organisations`, `org_members`, `services`, `service_staff`,
  `working_hours_template`, `working_hours_overrides`, `appointments`, `invitations`,
  `setup_requests`, `blocked_customers`, `notifications`, `billing_periods`, `billing_appeals`,
  `appointment_refunds`, `data_access_log`.

---

## 4. Edge functions and their callers

The middleware layer: 11 live Deno functions. What makes this layer awkward to reason about is
that it has **five different classes of caller**, each authenticated differently — including the
database itself, which calls out over HTTP through `pg_net`.

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart LR
  subgraph callers["Callers"]
    anon["Anon browser<br/>verify_jwt=false"]
    jwt["Signed-in browser<br/>verify_jwt=true"]
    gw["Payment gateway<br/>x-payment-secret"]
    db["Postgres via pg_net<br/>x-sms-secret"]
    e2e["Edge to edge<br/>x-internal-key"]
  end

  subgraph live["Live edge functions"]
    reqotp["request-booking-otp"]
    verotp["verify-booking-otp"]
    reqpw["request-password-reset"]
    respw["reset-password"]
    createpay["create-payment"]
    webhook["payment-webhook"]
    refund["refund-payment"]
    savecard["save-card"]
    manage["manage-appointment"]
    sendsms["send-sms"]
    delacct["delete-account"]
  end

  subgraph dead["Deployed but DEAD — do not call"]
    d1["get-available-slots"]
    d2["book-appointment"]
    d3["claim-waitlist - inert"]
    d4["api - 410 tombstone"]
  end

  subgraph prov["Providers"]
    smsp["SMS provider<br/>mock"]
    payp["Payment gateway<br/>mock"]
  end

  anon --> reqotp
  anon --> verotp
  anon --> reqpw
  anon --> respw
  anon --> createpay
  anon --> manage
  jwt --> refund
  jwt --> savecard
  jwt --> delacct
  gw --> webhook
  db --> sendsms
  manage -.->|"gateway rewrites authorization,<br/>so a custom header is used"| e2e
  e2e --> reqotp
  e2e --> verotp

  reqotp --> smsp
  reqpw --> smsp
  sendsms --> smsp
  webhook --> smsp
  refund --> smsp
  manage --> smsp
  createpay --> payp
  webhook --> payp
  refund --> payp
  savecard --> payp

  classDef gone stroke-dasharray:6 4,opacity:0.55
  class d1,d2,d3,d4 gone
```

**Worth knowing**

- **Four functions are still `ACTIVE` in the Supabase dashboard but dead in the code**:
  `get-available-slots`, `book-appointment`, `claim-waitlist` and `api` (the withdrawn public REST
  API, now a 410 tombstone). They are listed here precisely so nobody wires something to them.
  They are pending manual deletion from the dashboard.
- `manage-appointment` calls `request-booking-otp` / `verify-booking-otp` **server to server** and
  must pass `x-internal-key` rather than `authorization` — the functions gateway rewrites the
  `authorization` header on internal calls, so a bearer token would not survive the hop.
- `payment-webhook` has a **mock branch that is a deliberate dev backdoor**, double-gated on
  `ALLOW_MOCK_PAYMENTS=true`. It must be unset before launch.
- `verify-booking-otp` accepts the test code `000000` when `ALLOW_TEST_OTP` /
  `ALLOW_TEST_OTP_HOSTED` are set. `reset-password` has **no** such bypass, by design.
- `create-payment` recomputes the amount server-side from `services.price`; the client's number is
  never trusted.
- Provider resolution order for both seams: env var → `platform_config.payment_provider` /
  `.sms_provider` → `mock`. An unrecognised name **fails closed** rather than defaulting.

---

## 5. Database

28 live tables, every one with RLS enabled. `organisations` is the tenancy root — almost everything
carries an `org_id` FK back to it, and the RLS policies are built on the SECURITY DEFINER helpers
`get_user_org_ids()` / `get_user_org_role()`.

Split into three diagrams by domain, because 28 tables on one canvas is unreadable. Columns shown
are primary keys, foreign keys, and the ones that **carry behaviour** — not the full column list.

### 5a. Tenancy, catalog and booking

```mermaid
%%{init: {'theme':'neutral'}}%%
erDiagram
  organisations ||--o{ org_members : "staff"
  organisations ||--o{ invitations : "pending staff"
  organisations ||--o{ services : "catalog"
  organisations ||--o{ service_staff : ""
  organisations ||--|| working_hours_template : "weekly schedule"
  organisations ||--o{ working_hours_overrides : "per-date exceptions"
  organisations ||--o{ appointments : ""
  organisations ||--o{ pending_bookings : "awaiting payment"
  organisations ||--o{ booking_page_views : "daily counter"
  services      ||--o{ appointments : ""
  services      ||--o{ service_staff : ""
  org_members   ||--o{ service_staff : "bookable for"
  org_members   ||--o{ appointments : "assigned staff"
  customers     ||--o{ appointments : "by phone lookup"

  organisations {
    uuid id PK
    text slug "public booking URL"
    uuid owner_id FK "auth.users"
    bool sms_enabled "gates OTP + SMS add-on billing"
    bool require_approval "on-site bookings only"
    text billing_status "active|past_due|suspended"
    bool billing_exempt "superadmin-owned orgs"
    timestamptz usage_anchor
    timestamptz billing_review_until
    text deposit_type "none|fixed|percent"
    jsonb payment_config
  }
  services {
    uuid id PK
    uuid org_id FK
    numeric price "server-side source of truth"
    int2 max_per_slot "capacity"
    text location_type
    text deposit_type "overrides org default"
  }
  customers {
    uuid id PK
    text phone_number "normalized, no leading +"
    timestamptz consent_accepted_at
    text consent_version
  }
  appointments {
    uuid id PK
    uuid org_id FK
    uuid service_id FK
    uuid customer_id FK
    uuid staff_id FK
    timestamptz scheduled_at
    text status "pending|approved|completed|cancelled|no_show"
    text source "public|admin - stamped by trigger"
    bool sms_billable "stamped at insert, then frozen"
    timestamptz billable_locked_at
    timestamptz anonymized_at "retention"
  }
  pending_bookings {
    uuid id PK
    text status "claimed atomically by webhook"
    text payment_reference
    bool is_deposit
  }
  org_members {
    uuid id PK
    uuid user_id FK "null for non-login staff"
    text role "owner|admin"
    bool is_bookable
  }
  booking_page_views {
    uuid org_id PK,FK
    date day PK
    int4 views "no visitor id stored"
  }
```

**Worth knowing**

- `org_members.user_id` is **nullable** — non-login staff exist. Anything fanning out over members
  must tolerate that; a `NOT NULL` assumption here once silenced every notification for affected
  orgs.
- `pending_bookings` is the parking lot for online bookings that have not been paid for yet. It is
  written and read **only** by the payment edge functions via the service role, and promoted into a
  real `appointments` row by `payment-webhook`.
- `booking_page_views` stores a per-org **daily counter and nothing else** — no visitor id, no IP.
  Deduplication happens in the browser. Anon can write via RPC but cannot read.
- `appointments.source` and `sms_billable` are stamped by `trg_000_stamp_appointment_origin` at
  insert, so a client cannot claim `admin` to dodge the per-SMS fee.

### 5b. Billing and payments

Post-paid: usage accrues through the month, `billing-close` cuts an invoice, `billing-charge`
charges the card on file. Pricing is flat ₾15/month plus ₾0.7 per SMS-billable appointment.

```mermaid
%%{init: {'theme':'neutral'}}%%
erDiagram
  organisations   ||--o{ billing_periods : "one invoice per month"
  organisations   ||--o{ org_payment_methods : "card on file"
  organisations   ||--o{ billing_events : "dunning trail"
  organisations   ||--o{ billing_appeals : "Art.19 appeal"
  organisations   ||--o{ payment_log : ""
  organisations   ||--o{ appointment_refunds : ""
  billing_periods ||--o{ billing_line_items : "immutable ledger"
  billing_periods ||--o{ billing_events : ""
  appointments    ||--o| billing_line_items : "UNIQUE - idempotent"
  appointments    ||--o{ payment_log : "customer charge"
  appointments    ||--o{ appointment_refunds : ""

  billing_periods {
    uuid id PK
    uuid org_id FK
    date period_start
    date period_end
    int4 appointment_count
    numeric amount_due
    numeric amount_rolled_forward "OUTGOING carry"
    text status
    int4 attempts "dunning retry"
    timestamptz next_retry_at
  }
  billing_line_items {
    uuid id PK
    uuid billing_period_id FK
    uuid appointment_id FK "UNIQUE"
    numeric amount
    text kind "base fee vs per-SMS"
  }
  org_payment_methods {
    uuid id PK
    text token "provider token, never a PAN"
    text last4
    text brand
    bool is_default
  }
  payment_log {
    uuid id PK
    text purpose "appointment|subscription"
    text provider_reference
    text status
    timestamptz refunded_at
  }
  appointment_refunds {
    uuid id PK
    numeric amount
    bool is_full
    uuid initiated_by FK "auth.users"
    bool cancelled_appointment
  }
  billing_appeals {
    uuid id PK
    text status
    timestamptz review_until "grants a grace window"
  }
```

**Worth knowing**

- `billing_line_items.appointment_id` is **UNIQUE** — that is what keeps the close job idempotent
  if it runs twice.
- `amount_rolled_forward` is the **outgoing** carry to the *next* period, not an incoming balance.
  Reading it the other way inverts a month's invoice.
- `payment_log` is superadmin-only because it also holds platform subscription charges;
  `appointment_refunds` is the org-readable view of refund activity.
- Only appointments in `('approved','completed','no_show')` are counted, so a `pending` request
  costs the business nothing until it is approved.
- **The org itself cannot write any of the billing fields on `organisations`** — see
  `trg_prevent_billing_self_update` in §7.

### 5c. Comms, compliance and platform

```mermaid
%%{init: {'theme':'neutral'}}%%
erDiagram
  organisations ||--o{ sms_log : "delivery audit"
  organisations ||--o{ notifications : "in-app bell"
  organisations ||--o{ reviews : ""
  organisations ||--o{ blocked_customers : "per-org, never platform-wide"
  organisations ||--o{ data_access_log : "Art.27 processing log"
  organisations ||--o{ setup_requests : "concierge onboarding"
  appointments  ||--o{ sms_log : ""
  appointments  ||--o{ notifications : ""
  appointments  ||--o| reviews : "UNIQUE - one per appointment"

  sms_log {
    uuid id PK
    text recipient_phone
    text message_type
    text provider
    text status "updated by delivery report"
  }
  notifications {
    uuid id PK
    uuid user_id FK "auth.users"
    text type
    timestamptz read_at
  }
  reviews {
    uuid id PK
    uuid appointment_id FK "UNIQUE"
    int2 rating
    text author_name
  }
  blocked_customers {
    uuid id PK
    text phone
    text phone_hash "peppered - survives erasure"
    uuid blocked_by FK
  }
  data_access_log {
    uuid id PK
    uuid actor_user_id
    text action
    jsonb detail
  }
  booking_verifications {
    uuid id PK
    text phone
    text code_hash "sha256 code:phone:secret"
    int4 attempts "max 5"
    timestamptz verified_at
    timestamptz consumed_at
  }
  password_reset_verifications {
    uuid id PK
    text code_hash
    int4 attempts
    timestamptz consumed_at
  }
  platform_config {
    int4 id PK "single row"
    text sms_provider
    text payment_provider
    jsonb otp_rate_limits
    jsonb retention_config
    jsonb billing_config
    text phone_hash_pepper
  }
  superadmins {
    uuid user_id PK,FK
    uuid added_by FK
  }
```

**Worth knowing**

- `blocked_customers` stores a **peppered hash** alongside the phone, so erasing a customer's data
  does not silently unblock them.
- `data_access_log` is **append-only**: no INSERT/UPDATE/DELETE policy exists, so only SECURITY
  DEFINER functions can write and the history cannot be edited. It covers superadmin RPCs; direct
  PostgREST reads are a documented residual — see [PROCESSING_RECORD.md](PROCESSING_RECORD.md).
- The two OTP tables are structurally identical but deliberately separate: booking verification and
  password recovery must not share an attempt budget.
- `platform_config` is a single row holding provider selection, rate limits, retention windows and
  the phone-hash pepper. `otp_rate_limits` currently holds **relaxed test values** that must be
  reset before launch.

### Storage buckets

| Bucket | Public | Limit | Note |
|---|---|---|---|
| `logos` | yes | 2 MB | org logo + `{org_id}/cover.{ext}` |
| `member-photos` | yes | 2 MB | staff avatars |
| `service-images` | yes | 5 MB | per-service galleries |
| `catalog-images` | yes | 5 MB | **orphaned** — policies dropped, pending manual deletion |

Write policies are org-folder-scoped: the first path segment must be an org id the caller belongs
to, via `get_user_org_ids()`, with a superadmin override.

---

## 6. Guest booking, end to end

The most tangled path in the system, and the one worth having a picture of. Two branches — on-site
and online — that converge on the same trigger chain. Note that the OTP step is **conditional**:
since `20260903120000` it only runs when the org has bought the SMS add-on
(`organisations.sms_enabled`).

```mermaid
%%{init: {'theme':'neutral'}}%%
sequenceDiagram
  autonumber
  actor C as Guest
  participant SPA as Booking SPA
  participant RPC as Postgres RPC
  participant EF as Edge functions
  participant GW as Payment gateway
  participant DB as appointments + triggers

  C->>SPA: pick service, slot, enter name + phone
  SPA->>RPC: get_public_org / get_org_busy_slots

  alt org has SMS add-on (sms_enabled)
    SPA->>EF: request-booking-otp
    EF->>RPC: is_phone_blocked
    Note right of EF: blocklist is checked BEFORE<br/>the SMS is sent, not after
    EF->>RPC: check_otp_rate_limit
    EF-->>C: 6-digit code by SMS
    C->>SPA: enter code
    SPA->>EF: verify-booking-otp
  else add-on off
    Note over SPA: no OTP — the insert trigger<br/>skips verification too
  end

  alt pay on site or free
    SPA->>RPC: create_guest_booking
    RPC->>DB: customer + appointment in one txn
  else pay online or deposit
    SPA->>EF: create-payment
    EF->>RPC: recompute amount from services.price
    EF->>DB: park row in pending_bookings
    EF-->>SPA: checkoutUrl
    SPA->>GW: redirect to checkout
    C->>GW: pay
    GW->>EF: payment-webhook (x-payment-secret)
    EF->>RPC: claim_pending_booking
    Note right of EF: atomic claim — a retried callback<br/>cannot double-book
    RPC->>DB: promote to appointment, status approved
  end

  DB->>DB: trigger chain (see section 7)
  DB-->>C: confirmation SMS via pg_net to send-sms
  DB-->>SPA: in-app notification via Realtime
```

**Worth knowing**

- The **blocklist is checked before the OTP is sent**, so a blocked number never costs an SMS.
- `claim_pending_booking` exists because the original read-then-write idempotency check let a
  retried gateway callback both double-book *and* auto-refund a booking that had succeeded.
- A `pending` (awaiting-approval) booking **does not hold its slot**, so `approve_appointment`
  re-checks capacity under the per-org advisory lock and can legitimately fail with `slot_taken`.
- Anything paid online or carrying a deposit is **always** auto-approved — the money has moved.
  `require_approval` gates on-site bookings only.
- Customers receive exactly two messages: a confirmation on approval, and a morning-of reminder.

---

## 7. Async work — cron and triggers

Everything here runs with nobody watching, and it is where surprises live.

### Scheduled jobs

All six are `active` in `cron.job` as of 2026-08-31.

| Job | Schedule | Calls |
|---|---|---|
| `complete-elapsed-appointments` | `*/5 * * * *` | `complete_elapsed_appointments()` |
| `reject-elapsed-pending` | `*/5 * * * *` | `reject_elapsed_pending_appointments()` |
| `dispatch-appointment-reminders` | `*/15 * * * *` | `dispatch_appointment_reminders()` → `pg_net` → `send-sms` |
| `billing-close` | `0 3 * * *` | `run_billing_close()` → `close_billing_period_for_org()` |
| `billing-charge` | `30 3 * * *` | `run_usage_charges()` → `charge_billing_period()` + dunning |
| `purge-expired-data` | `30 3 * * *` | `purge_expired_data()` — retention across 9 tables |

### The `appointments` trigger chain

Postgres fires triggers in **alphabetical order by name**, which is why these are named
`trg_000…` through `trg_zz…`. The prefixes are load-bearing: renaming one reorders the chain.

```mermaid
%%{init: {'theme':'neutral'}}%%
flowchart TB
  ins["INSERT into appointments"] --> t1

  subgraph before["BEFORE INSERT — in firing order"]
    direction TB
    t1["trg_000_stamp_appointment_origin<br/>pins source + sms_billable"]
    t2["trg_00_normalize_guest_appointment<br/>phone normalize, deposit/price mirror"]
    t3["trg_enforce_appointment_limit"]
    t4["trg_enforce_booking_advance_window"]
    t5["trg_enforce_booking_verification<br/>ONLY when sms_enabled"]
    t6["trg_enforce_slot_capacity<br/>advisory lock — closes the race"]
    t7["trg_zz_block_blocked_customer<br/>NO service-role or superadmin bypass"]
    t1 --> t2 --> t3 --> t4 --> t5 --> t6 --> t7
  end

  t7 --> row[("row committed")]

  subgraph after["AFTER INSERT / UPDATE"]
    direction TB
    a1["trg_send_appointment_sms<br/>net.http_post to send-sms"]
    a2["trg_notify_new_appointment<br/>writes notifications"]
  end

  row --> a1
  row --> a2
  a1 --> sms["SMS provider"]
  a2 --> rt["Realtime to the bell"]

  subgraph upd["BEFORE UPDATE"]
    u1["trg_lock_billable_appointment<br/>freezes billable fields once counted"]
    u2["trg_clear_reminder_on_reschedule"]
  end
```

### Guards on other tables

| Table | Trigger | What it protects |
|---|---|---|
| `organisations` | `trg_prevent_billing_self_update` | **The column-level ACL.** Freezes `billing_status`, `billing_exempt`, `usage_anchor`, `owner_id`, `billing_review_until` |
| `organisations` | `trg_pin_org_billing_exempt` | Pins `billing_exempt` at insert |
| `org_members` | `trg_prevent_role_escalation` | Stops a member promoting themselves |
| `org_members` | `trg_enforce_staff_limit` | Seat cap |
| `blocked_customers` | `trg_normalize_blocked_phone`, `trg_set_blocked_customer_hash` | Normalizes and peppers the phone |
| `setup_requests` | `trg_notify_setup_request_completed` | `pg_net` → `send-sms` on completion |

**Worth knowing**

- ⚠️ **`organisations_update` has no column list.** That means `trg_prevent_billing_self_update`
  *is* the column-level access control for the whole table. **Any new sensitive column on
  `organisations` is tenant-writable until it is added to that trigger.**
- `trg_zz_block_blocked_customer` has **no service-role or superadmin bypass** — it applies to
  every caller. That is deliberate.
- `reject-elapsed-pending` is silent by design: the decline SMS fires only on a *human* rejection,
  which the trigger detects by testing `auth.uid()` — the cron sweep has none.
- Reminders were moved off a 24-hour lead to morning-of; see [APP_OVERVIEW.md](APP_OVERVIEW.md).

---

## Where to look next

| Topic | Document |
|---|---|
| What each feature does and why | [APP_OVERVIEW.md](APP_OVERVIEW.md) |
| Blocking items before launch | [SECURITY_PRE_LAUNCH.md](SECURITY_PRE_LAUNCH.md) |
| Turning on a real SMS provider | [SMS_PROVIDER_READINESS.md](SMS_PROVIDER_READINESS.md) |
| Georgian data-protection posture | [COMPLIANCE_GE_DPL.md](COMPLIANCE_GE_DPL.md), [PROCESSING_RECORD.md](PROCESSING_RECORD.md) |
| Incident handling | [BREACH_RUNBOOK.md](BREACH_RUNBOOK.md) |
