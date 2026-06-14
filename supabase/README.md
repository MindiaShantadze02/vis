# Supabase Migrations

## How to apply

Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/dnmecnpugjxkjonqsfxx/sql) and run the files **in order**:

| # | File | What it does |
|---|---|---|
| 1 | `migrations/001_tables.sql` | Drops old tables, creates all new tables |
| 2 | `migrations/002_functions.sql` | Helper SQL functions + `updated_at` triggers |
| 3 | `migrations/003_indexes.sql` | Performance indexes |
| 4 | `migrations/rls.sql` | Enables RLS + creates all access policies |
| 5 | `migrations/005_staff_and_capacity.sql` | Per-service slot capacity + assignable staff (run on existing DBs too) |

Copy-paste each file into the SQL editor and click **Run**.

---

## After running migrations

### 1. Set your superadmin user ID

After your first login to the app, find your Supabase user ID:
- Go to **Authentication → Users** in the Supabase dashboard
- Copy your user ID (uuid)

Then run this in the SQL editor:
```sql
UPDATE platform_config
SET superadmin_user_id = '<your-user-uuid>'
WHERE id = 1;
```

Also paste it into `client/.env`:
```
VITE_SUPERADMIN_USER_ID=<your-user-uuid>
```

### 2. Set up Storage buckets

In the Supabase dashboard go to **Storage** and create two buckets:

| Bucket name | Public? | Purpose |
|---|---|---|
| `logos` | Yes | Organisation logo images |
| `receipts` | No | Payment receipts (private) |

### 3. Enable Phone Auth

In **Authentication → Providers**:
- Enable **Phone** provider
- Set OTP expiry to **300 seconds** (5 minutes)
- For development, Supabase uses Twilio internally — you can use test phone numbers

---

## Schema overview

```
auth.users (Supabase managed)
    │
    ├── org_members ──────────── organisations
    │                                 │
    ├── invitations                   ├── services
    │                                 ├── working_hours_template
    │                                 ├── working_hours_overrides
    │                                 ├── appointments ── customers
    │                                 ├── notifications
    │                                 ├── sms_log
    │                                 └── subscription_payments
    │
    └── platform_config (single row, superadmin settings)
```

## Key design decisions

- **No `slots` table** — availability is computed at query time by `get_available_slots()` SQL function and the `get-available-slots` Edge Function. This avoids sync issues.
- **`get_user_org_ids()` is SECURITY DEFINER** — it queries `org_members` directly as postgres, bypassing RLS. This prevents circular policy evaluation (RLS on `org_members` would call this function, which queries `org_members`...).
- **Public INSERT on appointments/customers** — guest booking works without auth. The Edge Function (`book-appointment`) enforces all business rules (slot availability, limits) before inserting.
- **`platform_config` has one row** — tier limits and prices live here so you can adjust them via SQL without a code deploy.
