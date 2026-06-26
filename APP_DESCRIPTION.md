# Grafiki (brand: "Vis") — Appointment Booking SaaS

## What it is
A multi-tenant SaaS platform for the **Georgian market** that lets small service businesses (salons, spas, clinics, trainers, etc.) accept online appointment bookings. Each business gets a public booking page at a slug-based URL (`vis.ge/book/{slug}`), and a private dashboard to manage appointments, services, staff, working hours, payments, and team. There's also a platform-level superadmin area.

Two distinct audiences:
- **Customers (public, no login):** book an appointment via a multi-step flow.
- **Business owners/staff (authenticated):** manage their organization.
- **Superadmins:** oversee all organizations on the platform.

## Tech stack
- **Frontend:** React 19 + TypeScript, Vite build, React Router v7 (declarative routes, route guards).
- **UI:** Material-UI (MUI) v9 with Emotion (CSS-in-JS). No Tailwind. Centralized theme with custom palette, elevation/shadow tokens, and component overrides. Recently added **Framer Motion** for animation.
- **Icons:** @mui/icons-material. **Data grid/date pickers:** @mui/x-data-grid, @mui/x-date-pickers (date-fns adapter).
- **Backend:** **Supabase** (PostgreSQL + PostgREST + Auth + Realtime + Edge Functions + Storage). Row-Level Security (RLS) heavily used. Server logic in Postgres RPCs and Deno edge functions.
- **i18n:** i18next + react-i18next, **Georgian (ka) and English**. Noto Sans Georgian font. date-fns with Georgian locale.
- **Dates/money:** date-fns; prices in Georgian Lari (₾).
- **Testing:** Cypress E2E.

## Auth model
- Login is **phone number + password** (not email). Georgian phone format (e.g. `599 12 34 56`, stored E.164 without leading `+`).
- Auth state via React Context (`AuthContext`); current organization via `OrgContext`.
- SMS-based OTP for verifying customer phone during public booking, and for auth flows. SMS delivery is event-driven: a DB trigger → `send-sms` edge function → pluggable SMS provider.
- Route guards: `AuthGuard` (logged in), `OrgGuard` (has an organization), `SuperAdminGuard` (platform admin via `is_superadmin()` RPC), `PublicOnlyGuard` (redirects logged-in users away from login).

## Core data model (high level)
- **organisations** — business profile: name, slug, description, logo, contact_phone, booking_theme, subscription tier, payment config.
- **org_members** — team members; roles (admin/member), `is_bookable`, display_name, title, sort_order.
- **services** — name, duration_minutes, price, location type (in-person/online + meeting link), `max_per_slot` (capacity), is_active, sort_order.
- **service_staff** — which members can perform which service.
- **working_hours_template** — weekly Mon–Sun open/close ranges.
- **working_hours_overrides** — per-date closures/custom hours/rest periods (lunch breaks etc.).
- **appointments** — scheduled_at, duration, service_id, staff_id, customer, status (`pending | approved | rejected | cancelled | completed`), payment_method, payment_status, notes.
- **customers** — first/last name, phone.
- **notifications** — for the dashboard bell (e.g. new booking requests).
- Subscription tiers gate usage (e.g. monthly appointment limits); `org_can_accept_appointment` RPC enforces this even on the public page.

## Routes / pages

### Public (no login)
- `/book/:slug` — **multi-step booking wizard** (the revenue-generating, first-impression surface):
  1. **Service select** — cards with name/duration/price.
  2. **Date & time** — week calendar with availability, time-slot grid, staff selector ("Any available" or specific member), scarcity cues ("2 left"), auto-find next available day.
  3. **Customer details + payment method** — name, phone (validated), notes; **SMS OTP** phone verification; choose online vs in-person payment if both enabled.
  Booking state persists in sessionStorage so refreshes/payment redirects don't lose progress.
- `/booking-confirmation/:id` — success page; distinct states for pending (awaiting business approval, amber) vs confirmed (green); shows appointment details + business phone for cancellation.
- `/pay/mock`, `/payment-return` — payment gateway flow (mock provider for dev; real BOG / TBC bank integrations are pluggable).
- `/invite/:token` — accept an invitation to join an organization's team.

### Auth
- `/login` — tabbed sign in / sign up (phone + password).
- `/forgot-password` — password recovery.

### Onboarding (logged in, no org yet) — 3-step stepper
- `/onboarding/business` → business profile (name auto-derives slug, description, contact phone).
- `/onboarding/services` → add services.
- `/onboarding/hours` → set weekly working hours. Finishing creates the org and redirects to dashboard. Skippable.

### Dashboard (logged in)
Two-column layout: fixed sidebar on desktop, hamburger drawer on mobile; top bar with language switcher, notifications bell (with dropdown), user menu.
- `/dashboard` — **Overview** (home, most-visited): copyable booking link, 4 stat cards (revenue this week/month, today's appointments, pending approvals), searchable/filterable appointments table (desktop grid → mobile cards), appointment detail dialog with approve/reject/cancel + staff reassignment + notes, pending-invitations component.
- `/dashboard/calendar` — **week calendar** (responsive: 3-day view on phones): appointments rendered as duration-sized "pills" positioned by time, color-coded per service, overlap-packed into columns, with same-service overlapping bookings collapsed into counted pills; pending bookings flagged with an orange accent; rest-period (break) management; right-side detail drawer with approve/reject and staff reassignment.
- `/dashboard/settings/profile` — org name, description, logo upload (Supabase Storage), contact phone, **booking theme picker** (see below), danger zone (delete org / leave).
- `/dashboard/settings/services` — service CRUD, staff assignment, active toggle, reorder.
- `/dashboard/settings/hours` — weekly template + per-date overrides + rest periods.
- `/dashboard/settings/team` — members, roles, bookable status, service assignment, send/revoke invitations.
- `/dashboard/settings/payment` — enable/configure in-person + online (BOG / TBC bank) payment methods.
- `/dashboard/settings/subscription` — current tier, usage vs limits, plan comparison, billing.

### Superadmin
- `/superadmin` — platform metrics (org count, total appointments, signups).
- `/superadmin/orgs`, `/superadmin/orgs/:id` — organization list/detail with management.
- `/superadmin/admins` — manage superadmin users.

## Theming
- One global app theme (blue brand, status palette: success/teal, pending/amber, rejected/coral, completed/indigo).
- **7 selectable booking themes** for public pages (Indigo, Blue, Ocean, Sunset, Sporty, Rose, White), each remapping sidebar/page colors so a business can match its brand. Generated dynamically via `makeBookingTheme()`.

## UX/polish characteristics
- Consistent micro-interactions (hover lift, focus rings, snappy `cubic-bezier(0.16,1,0.3,1)` easing).
- Loading skeletons + spinners, toast notifications (success/error), friendly empty states.
- Recently added: route transitions, directional step-slides in booking, count-up stat cards, spring confirmation icon, staggered list reveals — all honoring `prefers-reduced-motion`.
- Responsive across phone/tablet/desktop (MUI breakpoints; mobile drawers; tables collapse to cards).

## Key flows in one line each
- **Customer booking:** pick service → pick date/time/staff → enter details → verify phone via SMS OTP → choose payment → confirmation (pending or auto-approved).
- **Owner onboarding:** sign up (phone) → business profile → services → hours → dashboard.
- **Owner daily use:** review pending requests on Overview/Calendar → approve/reject → manage schedule and settings.
