-- ============================================================
-- 071_public_api.sql
-- Run AFTER 070_otp_rate_limits.sql.
--
-- Public REST API v1 (the `api` edge function): businesses integrate booking
-- into their own apps with a per-organisation API key. This migration adds:
--
--   * api_keys            — hashed per-org keys, managed from the dashboard
--   * api_rate_counters   — fixed per-minute request counters per key
--   * create_api_key / revoke_api_key   — owner-facing key management RPCs
--   * authenticate_api_key              — service-role gate used per request
--                                         (auth + last_used + rate limit in one
--                                         round trip; caps live in
--                                         platform_config.api_rate_limits)
--   * api_create_booking                — service-role booking writer
--   * enforce_booking_verification amendment — see below
--
-- OTP-exemption design (IMPORTANT — audit before changing):
-- API bookings are made by the business itself (the key IS the business's
-- credential), so the guest phone-OTP gate does not apply. But the gate must
-- NOT get a blanket service_role exemption: payment-webhook inserts with the
-- service role and RELIES on enforce_booking_verification consuming the
-- customer's verified OTP (supabase/functions/payment-webhook/index.ts).
-- Instead api_create_booking sets a transaction-local GUC
-- (app.api_booking = '1') that only it can set — PostgREST callers cannot run
-- set_config — and the trigger early-exits on it. The webhook path is
-- untouched and still consumes OTPs.
--
-- Keys are 'grf_' + 48 hex chars (192 random bits): high-entropy, so plain
-- sha256 (no pepper) is preimage-safe and generation can live in Postgres.
-- Only the hash + a display prefix are stored; the full key is shown once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- --------------------------------------------------------
-- Key storage
-- --------------------------------------------------------
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name         varchar(60) NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text NOT NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);

COMMENT ON TABLE api_keys IS
  'Per-organisation public-API keys. key_hash = sha256 hex of the full key '
  '(''grf_'' + 48 hex, 192 random bits — no pepper needed at that entropy); '
  'key_prefix = first 12 chars for display. Full key is returned exactly once '
  'by create_api_key.';

CREATE INDEX idx_api_keys_org ON api_keys (org_id, created_at DESC);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Members may LIST their org's keys (hash+prefix only — safe). All writes go
-- through the RPCs below or the service role; no write policies on purpose.
CREATE POLICY api_keys_member_select ON api_keys FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

-- --------------------------------------------------------
-- Per-key fixed-window request counters (pruned inline by
-- authenticate_api_key; volumes are tiny at 60/min caps).
-- --------------------------------------------------------
CREATE TABLE api_rate_counters (
  key_id       uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 1,
  PRIMARY KEY (key_id, window_start)
);

COMMENT ON TABLE api_rate_counters IS
  'Fixed per-minute request counters per API key, maintained by '
  'authenticate_api_key. Service-role/definer access only.';

ALTER TABLE api_rate_counters ENABLE ROW LEVEL SECURITY;
-- no policies: definer/service-role only

-- --------------------------------------------------------
-- Tunable limits (mirrors otp_rate_limits, migration 070).
-- --------------------------------------------------------
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS api_rate_limits jsonb NOT NULL
  DEFAULT '{"per_key_per_minute":60}'::jsonb;

COMMENT ON COLUMN platform_config.api_rate_limits IS
  'Caps enforced by authenticate_api_key on the public REST API. '
  'per_key_per_minute: fixed-window request cap per API key.';

-- --------------------------------------------------------
-- Owner-facing key management. SECURITY DEFINER because authenticated users
-- have no direct INSERT/UPDATE on api_keys.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION create_api_key(p_name text)
RETURNS TABLE (id uuid, key text, key_prefix text, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_ids uuid[];
  v_org     uuid;
  v_name    text := trim(coalesce(p_name, ''));
  v_key     text;
  v_active  int;
BEGIN
  v_org_ids := get_user_org_ids();
  IF coalesce(array_length(v_org_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_organisation';
  END IF;
  v_org := v_org_ids[1];  -- one org per user (see migration 008)

  IF v_name = '' OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  SELECT count(*) INTO v_active
    FROM api_keys k WHERE k.org_id = v_org AND k.revoked_at IS NULL;
  IF v_active >= 5 THEN
    RAISE EXCEPTION 'key_limit_reached';
  END IF;

  v_key := 'grf_' || encode(extensions.gen_random_bytes(24), 'hex');

  RETURN QUERY
  INSERT INTO api_keys (org_id, name, key_hash, key_prefix, created_by)
  VALUES (
    v_org,
    v_name,
    encode(extensions.digest(v_key, 'sha256'), 'hex'),
    left(v_key, 12),
    auth.uid()
  )
  RETURNING api_keys.id, v_key, api_keys.key_prefix, api_keys.name::text;
END;
$$;

COMMENT ON FUNCTION create_api_key IS
  'Mints a public-API key for the caller''s org (max 5 active). Returns the '
  'full key exactly once; only sha256 + prefix are stored.';

CREATE OR REPLACE FUNCTION revoke_api_key(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE api_keys
     SET revoked_at = now()
   WHERE id = p_id
     AND revoked_at IS NULL
     AND org_id = ANY (get_user_org_ids());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'key_not_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION revoke_api_key IS
  'Revokes one of the caller''s org''s API keys (idempotence: raises '
  '''key_not_found'' if already revoked or not theirs).';

GRANT EXECUTE ON FUNCTION create_api_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_api_key(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_api_key(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION revoke_api_key(uuid) FROM PUBLIC, anon;

-- --------------------------------------------------------
-- Per-request gate for the `api` edge function: key auth + last_used bump +
-- rate limiting in one round trip. Returns no row for an invalid/revoked key.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION authenticate_api_key(p_key_hash text)
RETURNS TABLE (org_id uuid, rate_limited boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key_id uuid;
  v_org    uuid;
  v_limit  int;
  v_window timestamptz := date_trunc('minute', now());
  v_count  int;
BEGIN
  SELECT k.id, k.org_id INTO v_key_id, v_org
    FROM api_keys k
   WHERE k.key_hash = p_key_hash
     AND k.revoked_at IS NULL;

  IF v_key_id IS NULL THEN
    RETURN;  -- no row = invalid key
  END IF;

  UPDATE api_keys SET last_used_at = now() WHERE id = v_key_id;

  -- Count this request in the current minute window; prune old windows inline
  -- (cheap: at most limit rows/minute/key, and only this key's rows).
  INSERT INTO api_rate_counters (key_id, window_start)
  VALUES (v_key_id, v_window)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET count = api_rate_counters.count + 1
  RETURNING api_rate_counters.count INTO v_count;

  DELETE FROM api_rate_counters
   WHERE key_id = v_key_id AND window_start < now() - interval '1 hour';

  SELECT coalesce((pc.api_rate_limits ->> 'per_key_per_minute')::int, 60)
    INTO v_limit FROM platform_config pc WHERE pc.id = 1;

  RETURN QUERY SELECT v_org, v_count > v_limit;
END;
$$;

COMMENT ON FUNCTION authenticate_api_key IS
  'Public-API request gate: resolves an unrevoked key by sha256 hash, bumps '
  'last_used_at, counts the request against the per-minute window and returns '
  '(org_id, rate_limited). No row = invalid key. Service-role only.';

REVOKE EXECUTE ON FUNCTION authenticate_api_key(text) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------
-- OTP gate amendment: transaction-local exemption for api_create_booking ONLY.
-- Body copied from migration 030 with the flag check added; the service-role
-- webhook path still consumes OTPs (see header).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_booking_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text;
  v_id    uuid;
BEGIN
  -- API booking (api_create_booking sets this transaction-local flag; nothing
  -- else can — PostgREST callers cannot run set_config): the business books on
  -- its own behalf via its API key, so no guest OTP. NOT a service_role
  -- exemption: payment-webhook must keep consuming OTPs below.
  IF current_setting('app.api_booking', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Admin of THIS org creating the appointment themselves: no OTP required.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id
      AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT c.phone_number INTO v_phone
    FROM customers c
   WHERE c.id = NEW.customer_id;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'verification_required';
  END IF;

  SELECT bv.id INTO v_id
    FROM booking_verifications bv
   WHERE bv.phone = v_phone
     AND bv.verified_at IS NOT NULL
     AND bv.consumed_at IS NULL
     AND bv.expires_at > now()
   ORDER BY bv.created_at DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'verification_required';
  END IF;

  UPDATE booking_verifications SET consumed_at = now() WHERE id = v_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_booking_verification IS
  'BEFORE INSERT on appointments: requires a verified, unexpired OTP for the '
  'customer phone (guest bookings) and consumes it. Exempts org-member inserts '
  'and api_create_booking (app.api_booking GUC). Raises ''verification_required''.';

-- --------------------------------------------------------
-- The API booking writer. Service-role only (called by the `api` edge function
-- after key auth + server-side slot validation). Duration always comes from
-- the service row; payment fields are pinned here because the 069 normaliser
-- exempts service_role.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION api_create_booking(
  p_org_id          uuid,
  p_service_id      uuid,
  p_first_name      text,
  p_last_name       text,
  p_phone           text,
  p_scheduled_at    timestamptz,
  p_staff_id        uuid DEFAULT NULL,
  p_notes           text DEFAULT NULL,
  p_status          text DEFAULT 'pending',
  p_consent_version text DEFAULT NULL
)
RETURNS TABLE (appointment_id uuid, status text, scheduled_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration    int;
  v_customer_id uuid;
  v_appt_id     uuid;
BEGIN
  IF p_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = p_service_id
       AND ss.member_id = p_staff_id
       AND m.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  -- Transaction-local: read by enforce_booking_verification (see above).
  PERFORM set_config('app.api_booking', '1', true);

  INSERT INTO customers (first_name, last_name, phone_number,
                         consent_accepted_at, consent_version)
  VALUES (p_first_name, nullif(trim(coalesce(p_last_name, '')), ''), p_phone,
          now(), p_consent_version)
  RETURNING customers.id INTO v_customer_id;

  INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at,
                            duration_minutes, staff_id, status,
                            payment_method, payment_status,
                            payment_provider, payment_reference,
                            notes, admin_notes)
  VALUES (p_org_id, p_service_id, v_customer_id, p_scheduled_at,
          v_duration, p_staff_id, p_status,
          'in_person', 'unpaid',
          NULL, NULL,
          nullif(trim(coalesce(p_notes, '')), ''), NULL)
  RETURNING appointments.id INTO v_appt_id;

  RETURN QUERY SELECT v_appt_id, p_status, p_scheduled_at;
END;
$$;

COMMENT ON FUNCTION api_create_booking IS
  'Public-API booking writer: validates service/staff, sets the app.api_booking '
  'GUC (OTP exemption), inserts customer + appointment with pinned payment '
  'fields. Tier-limit / advance-window / SMS triggers still apply. Raises '
  'invalid_status | service_not_found | staff_not_available (plus trigger '
  'errors limit_reached, booking_too_far_in_advance). Service-role only.';

REVOKE EXECUTE ON FUNCTION api_create_booking(uuid, uuid, text, text, text, timestamptz, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
