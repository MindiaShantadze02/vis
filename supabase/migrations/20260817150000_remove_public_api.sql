-- ============================================================
-- 20260817150000_remove_public_api.sql
--
-- Removes the public REST API v1 (migration 071 + the `api` edge function).
-- The feature is withdrawn: businesses integrate through the embeddable
-- booking widget (/docs/widget) instead. The `api` edge function was retired to
-- a 410 Gone stub BEFORE this migration ran, so no live endpoint is left
-- calling the RPCs dropped below.
--
-- Dropped: api_keys, api_rate_counters, platform_config.api_rate_limits,
--          create_api_key, revoke_api_key, authenticate_api_key,
--          api_create_booking.
--
-- IMPORTANT — the transaction-local GUC `app.api_booking`:
-- api_create_booking was the ONLY writer of that GUC, and two live trigger
-- functions read it. With the writer gone, current_setting('app.api_booking',
-- true) is NULL in every session, so both branches are provably dead. They are
-- re-created here without the GUC so no misleading logic survives:
--
--   * enforce_booking_verification() — last set in 071 (the 030 body plus an
--     early RETURN when the GUC is '1'). Restored to the exact 030 body. The
--     payment-webhook path is UNCHANGED and still consumes the customer's
--     verified OTP; create_guest_booking never set the GUC either, so the
--     public booking flow is unchanged.
--
--   * enforce_slot_capacity() — last set in 084. Its trusted-context exemption
--     read `(auth.role() = 'service_role' AND GUC IS DISTINCT FROM '1')`. With
--     the GUC permanently NULL, `NULL IS DISTINCT FROM '1'` is TRUE, so that
--     conjunct reduces to `auth.role() = 'service_role'` — which is what is
--     kept here. Dropping the whole disjunct instead would newly subject the
--     payment webhook to `slot_taken`, which 084 explicitly rejects (it would
--     take money without a booking, and there is no refund path there).
--
-- pgcrypto is deliberately NOT dropped: 071 created it IF NOT EXISTS, but it is
-- a Supabase default and dropping it is needless blast radius.
--
-- No triggers are re-created: CREATE OR REPLACE FUNCTION keeps
-- trg_enforce_booking_verification and trg_enforce_slot_capacity bound. A
-- DROP ... CASCADE here would silently detach them and leave bookings ungated.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop the API surface (functions first, then storage).
--    The live api_create_booking is the 9-arg form from 20260814120000; the
--    10-arg 071/075 form is dropped defensively for environments that are
--    behind.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.api_create_booking(uuid, uuid, text, text, text, timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS public.api_create_booking(uuid, uuid, text, text, text, timestamptz, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.authenticate_api_key(text);
DROP FUNCTION IF EXISTS public.create_api_key(text);
DROP FUNCTION IF EXISTS public.revoke_api_key(uuid);

-- Counters first (FK → api_keys). Dropping api_keys takes idx_api_keys_org and
-- the api_keys_member_select policy with it.
DROP TABLE IF EXISTS public.api_rate_counters;
DROP TABLE IF EXISTS public.api_keys;

ALTER TABLE public.platform_config DROP COLUMN IF EXISTS api_rate_limits;

-- ------------------------------------------------------------
-- 2. enforce_booking_verification — restored to the pre-071 (030) body.
--    Every guest insert (booking page via create_guest_booking, raw anon
--    PostgREST insert, payment-webhook insert) again requires and consumes a
--    verified, unexpired, unconsumed OTP for the customer's phone. Only members
--    of THIS org are exempt.
-- ------------------------------------------------------------
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
  'customer phone (guest bookings) and consumes it; exempts org-member inserts. '
  'Raises ''verification_required''. The api_create_booking GUC exemption was '
  'removed with the public REST API (20260817150000).';

-- ------------------------------------------------------------
-- 3. enforce_slot_capacity — the 084 body with the now-dead app.api_booking
--    conjunct removed (see the header for why the service_role exemption
--    stays). Everything else is byte-identical.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_slot_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap      int;
  v_start    timestamptz;
  v_end      timestamptz;
  v_overlaps int;
BEGIN
  -- Trusted contexts may overbook deliberately: the payment webhook
  -- (service_role — the charge has already cleared), superadmins, and members
  -- of the target org.
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent untrusted inserts for this org. Transaction-scoped:
  -- released automatically on commit/rollback. create_guest_booking takes the
  -- same lock (advisory locks are reentrant within a session), so its staff
  -- auto-assignment and this check see the same frozen busy-set.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.org_id::text));

  v_start := NEW.scheduled_at;
  v_end   := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);

  -- Per-service capacity, same semantics as the client (Step3) and slots.ts:
  -- overlapping = aStart < slotEnd AND aEnd > slotStart, statuses excluding
  -- only rejected/cancelled (matching get_org_busy_slots, 066/075). The lower
  -- scheduled_at bound keeps idx_appointments_org_scheduled usable; no
  -- appointment lasts a day.
  SELECT s.max_per_slot INTO v_cap
    FROM services s
   WHERE s.id = NEW.service_id;

  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = NEW.org_id
     AND a.service_id = NEW.service_id
     AND a.status NOT IN ('rejected', 'cancelled')
     AND a.scheduled_at > v_start - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start;

  IF v_overlaps >= coalesce(v_cap, 1) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  -- A named person can't be in two places at once (any service counts).
  IF NEW.staff_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM appointments a
     WHERE a.org_id = NEW.org_id
       AND a.staff_id = NEW.staff_id
       AND a.status NOT IN ('rejected', 'cancelled')
       AND a.scheduled_at > v_start - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_slot_capacity IS
  'BEFORE INSERT on appointments: under a per-org advisory lock, rejects '
  'untrusted inserts that exceed the service''s max_per_slot or double-book a '
  'staff member (raises ''slot_taken''). Exempts org members, superadmins and '
  'the payment webhook. Closes the guest check-then-insert race (084); the '
  'public-API carve-out was removed with the API (20260817150000).';
