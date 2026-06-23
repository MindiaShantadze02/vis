# vis — Appointment Management SaaS

## What it is
A multi-tenant SaaS platform for the **Georgian market** that lets small businesses (salons, clinics, trainers, etc.) take online appointment bookings. Each business gets a **public booking page** (`/book/[slug]`) to share on social media. End customers book as **guests** (no account — just name + phone). Business owners manage everything through an admin dashboard with a weekly calendar.

## Tech stack
- **Frontend:** React 19 + TypeScript + Vite, MUI v9 (Material UI), MUI X DataGrid + Date Pickers, React Router v7
- **Backend:** Supabase only (Postgres + Auth + Edge Functions + Realtime) — **no separate Node server**
- **Edge Functions (Deno):** `get-available-slots`, `book-appointment`, `delete-account`
- **i18n:** Georgian (default), Russian, English via react-i18next
- **Auth:** Email + password (Supabase Auth) — phone OTP planned for the future
- **Testing:** Cypress (e2e)
- **Currency:** Georgian Lari (₾)

## User roles
1. **Guest customer** — books appointments publicly, no login
2. **Business admin / org members** — manage their organization (multi-admin via invitations)
3. **Superadmin** — platform owner; manages all orgs, overrides subscription tiers, views platform stats

## Core flows

### Public booking (3 steps)
1. **Select service** → 2. **Pick date & time** (available slots computed live by the `get-available-slots` edge function — there's no pre-generated slots table) → 3. **Customer form** (name + phone, optional notes). Booking is created via the `book-appointment` edge function, then a confirmation page. Supports themed booking pages.

### Onboarding (3-step wizard)
Business profile → Services → Working hours. Users can also skip onboarding and land on an empty dashboard.

### Admin dashboard
- **Overview** — stats + revenue totals (week/month)
- **Weekly calendar** (HarvestApp-style week view) — view/manage appointments, add appointments manually, approve/reject pending bookings
- **Realtime in-app notifications** for new bookings
- **Settings:** profile, services, working hours, team (invite members), payment credentials, subscription

### Superadmin panel (`/superadmin`)
Platform overview, org list & detail, tier overrides, managing other superadmins (multi-superadmin support).

## Key domain model
- `organisations` (one org per user), `services` (per org, with duration & location), `appointments`, `customers` (name + phone only)
- Availability: `working_hours_template` (weekly recurring) + `working_hours_overrides` (per-date exceptions); slots computed at query time
- Multi-tenancy enforced via **Postgres RLS**
- Team: `org_members` + email `invitations`
- **Subscription tiers:** Free (30/mo), Starter ₾15 (200/mo), Pro ₾40 (600/mo), Business ₾80 (unlimited). Limits stored in `platform_config.tier_limits` JSON so the superadmin can change them without a deploy. Usage tracked & enforced via `org_can_accept_appointment`.
- `pg_cron` jobs: auto-complete past appointments; appointment notifications
- Account deletion supported (cascades org data)

## What's NOT built yet (per `docs/ROADMAP.md`)
- **Subscription billing** — upgrade UI exists but the button isn't wired to a real checkout
- **Online booking payments** — BOG Pay / TBC Pay (Georgian gateways) credentials collected but "Coming Soon"; payment columns exist on appointments
- **Outbound SMS/email delivery** — pluggable SMS layer exists (`supabase/functions/_shared/sms/`, `SmsProvider` interface); a **mock** provider is wired for booking confirmations (logs only, nothing delivered). No real gateway or email provider yet
- **Password reset / email change**
- Appointment reminders, customer self-service cancel/reschedule, customer email capture, CRM/customer directory, analytics, data export
