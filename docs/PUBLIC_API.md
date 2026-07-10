# Vis Public REST API (v1)

Integrate Vis booking into your own website, app, or backend. The API
exposes the same availability and booking rules as your public booking page.

- **Base URL:** `https://dnmecnpugjxkjonqsfxx.supabase.co/functions/v1/api`
- **Auth:** per-organisation API key, minted in **Dashboard → Settings → API keys**
- **Format:** JSON in/out, UTF-8
- **Timezone:** all dates/times are **Georgia business time (UTC+4)**

> **Keep your key server-side.** Requests must come from your backend. A key
> embedded in browser or mobile code can be extracted and used by anyone —
> revoke it immediately if that happens (Settings → API keys → Revoke).

## Authentication

Pass the key in the `x-api-key` header (or `Authorization: Bearer <key>`):

```bash
curl -H "x-api-key: grf_..." \
  "https://dnmecnpugjxkjonqsfxx.supabase.co/functions/v1/api/v1/services"
```

The key identifies your organisation — every endpoint is automatically scoped
to it. Up to 5 active keys per organisation. Revocation is immediate.

**Rate limit:** 60 requests per key per minute (HTTP 429 when exceeded).

## Endpoints

### GET /v1/organisation

Your organisation's public profile.

```json
{ "organisation": { "id": "…", "name": "…", "slug": "…", "description": "…",
                    "contact_phone": "595…", "logo_url": "…" } }
```

### GET /v1/services

Active services, in your configured display order.

```json
{ "services": [ { "id": "…", "name": "Consultation", "duration_minutes": 30,
                  "price": 50, "max_per_slot": 1 } ] }
```

### GET /v1/slots?service_id=&lt;uuid&gt;&date=YYYY-MM-DD[&staff_id=&lt;uuid&gt;]

Free start times for one day, honouring working hours, per-day overrides,
existing bookings, per-service capacity, staff availability, and your advance
booking window. Past times are excluded automatically.

```json
{ "service_id": "…", "date": "2026-07-15", "timezone": "+04:00",
  "slots": [ { "time": "09:00", "remaining": 1, "total": 1 }, … ] }
```

`remaining`/`total` reflect slot capacity (`max_per_slot` × staff availability).
Omit `staff_id` for "any available staff member".

### POST /v1/bookings

Creates an in-person booking (the API equivalent of your public booking page).

```bash
curl -X POST -H "x-api-key: grf_..." -H "content-type: application/json" \
  -d '{
    "service_id": "f3578227-…",
    "date": "2026-07-15",
    "time": "11:00",
    "customer": { "first_name": "Nino", "last_name": "K.", "phone": "555123456" },
    "staff_id": null,
    "notes": "prefers window seat",
    "status": "pending"
  }' \
  "https://dnmecnpugjxkjonqsfxx.supabase.co/functions/v1/api/v1/bookings"
```

- `phone` — Georgian number (`5XXXXXXXX`, `+995` prefix accepted).
- `staff_id` — optional; omitted/null means "any available" (the API pins a
  concrete free member, like the booking page).
- `status` — `pending` (default; appears in your approval queue) or
  `approved` (skips approval — you are booking on your own behalf).
- The requested time is re-validated server-side against live availability
  just before insert; a taken slot returns **409**.

Response `201`:

```json
{ "booking": { "id": "…", "status": "pending",
               "scheduled_at": "2026-07-15T07:00:00+00:00", "staff_id": "…" } }
```

Notes:
- **No customer OTP** is required on this path — your API key is the trusted
  credential. By calling this endpoint you confirm the customer consented to
  the booking and to Vis's privacy terms (the consent timestamp/version is
  recorded on the customer record).
- SMS behaviour matches the booking page: a `pending` booking texts the
  customer when you approve it; an `approved` booking texts immediately.
- Bookings count against your plan's monthly appointment quota (403 when full).

## Errors

Uniform shape: `{ "error": "<code>", "message": "<human readable>" }`

| HTTP | code | meaning |
|------|------|---------|
| 401 | `invalid_key` | missing/unknown/revoked key |
| 429 | `rate_limited` | over 60 req/min for this key |
| 404 | `service_not_found` | not your org's active service |
| 404 | `not_found` | unknown route |
| 409 | `slot_unavailable` | requested time not free (race or stale slot list) |
| 403 | `quota_exceeded` | monthly appointment limit reached |
| 422 | `invalid_date` / `invalid_time` / `invalid_phone` / `invalid_name` / `invalid_notes` / `invalid_status` / `invalid_service_id` / `invalid_staff_id` / `staff_not_available` / `too_far_in_advance` | validation failures |
| 500 | `internal` | unexpected server error (details are logged server-side, never returned) |

**Race window:** like the booking page, availability is checked immediately
before insert but not locked — two bookings for the same last slot within the
same instant can, in principle, both succeed. Treat 409 as "refresh slots and
retry".

## Implementation map (for maintainers)

- Edge function: `supabase/functions/api/index.ts` (router, key auth, slot
  re-validation) + `_shared/slots.ts` (Deno port of `client/src/lib/slots.ts` —
  keep in sync).
- DB: migration `071_public_api.sql` — `api_keys`, `api_rate_counters`,
  `create_api_key`/`revoke_api_key` (dashboard RPCs), `authenticate_api_key`
  (service-role gate), `api_create_booking` (service-role writer; the ONLY
  OTP-exempt insert path, via the transaction-local `app.api_booking` GUC —
  see the migration header before touching `enforce_booking_verification`).
- Limits: `platform_config.api_rate_limits` JSONB (superadmin-tunable, no
  deploy needed).
- Dashboard UI: `client/src/pages/dashboard/settings/ApiKeysSettings.tsx`
  (route `settings/api`).
