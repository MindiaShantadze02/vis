-- ============================================================
-- 081_security_audit_hardening.sql
-- Run AFTER 080_require_approval_default.sql.
--
-- Fixes from the 2026-07-12 security audit. All changes are tenant-safe and
-- keep the existing guest-booking / admin flows working.
--
--   1. Lock purge_expired_data  — the one internal cron fn migration 073 missed;
--      it was executable by anon/authenticated with no authz check.
--   2. Restrict anonymous customer INSERT to OTP-verified guests (or any signed-in
--      member) — replaces the WITH CHECK(true) blanket policy.
--   3. (edge functions — handled outside this migration)
--   4. Pin search_path on the core SECURITY DEFINER auth helpers + the siblings
--      the Supabase linter flagged (defense-in-depth; get_user_org_ids underlies
--      every RLS policy).
--   5. normalize_guest_appointment: enforce service↔org tenant integrity, pin
--      duration from the service row, and validate a named staff member — a
--      tampered booking client could previously set these freely.
--   6. Storage MIME allowlists (image-only) + relocate pg_trgm out of public.
--      pg_net is non-relocatable (functions live in the `net` schema) and is
--      left as-is. Auth "leaked password protection" is a project Auth setting
--      that must be toggled in the dashboard (no SQL path).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Lock the retention/anonymization cron function.
--    pg_cron / the service role bypass GRANTs, so scheduling is unaffected.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION purge_expired_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION purge_expired_data() FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. Pin search_path on flagged functions (mutable search_path lint).
-- ------------------------------------------------------------
ALTER FUNCTION public.get_user_org_ids()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_org_role(uuid)               SET search_path = public, pg_temp;
ALTER FUNCTION public.get_available_slots(uuid, uuid, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.org_usage(uuid)                       SET search_path = public, pg_temp;
ALTER FUNCTION public.current_period_start(timestamptz)     SET search_path = public, pg_temp;
ALTER FUNCTION public.reset_usage_anchor_on_tier_change()   SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at()                   SET search_path = public, pg_temp;

-- ------------------------------------------------------------
-- 2. Anonymous customer inserts must correspond to a verified guest OTP.
--    booking_verifications SELECT is superadmin-only under RLS, so the check
--    goes through a SECURITY DEFINER helper (same pattern as get_user_org_ids).
--    Phone format matches: customers.phone_number and booking_verifications.phone
--    are both the bare 9-digit national number.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_verified_booking_otp(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM booking_verifications bv
    WHERE bv.phone = p_phone
      AND bv.verified_at IS NOT NULL
      AND bv.consumed_at IS NULL
      AND bv.expires_at > now()
  );
$$;

COMMENT ON FUNCTION has_verified_booking_otp IS
  'True if a verified, unconsumed, unexpired guest booking OTP exists for the '
  'phone. Used by the customers INSERT policy so anonymous rows can only be '
  'created as part of an OTP-verified booking.';

REVOKE EXECUTE ON FUNCTION has_verified_booking_otp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_verified_booking_otp(text) TO anon, authenticated;

DROP POLICY IF EXISTS customers_public_insert ON customers;
CREATE POLICY customers_insert ON customers FOR INSERT
  WITH CHECK (
    -- Signed-in members create customers for in-person / manual bookings.
    auth.uid() IS NOT NULL
    -- Guests may only create a customer row for a phone they just verified.
    OR has_verified_booking_otp(phone_number)
  );

-- ------------------------------------------------------------
-- 5. Harden the guest appointment normaliser: pin the service-derived fields and
--    reject cross-org service / unassigned staff. Trusted contexts still bypass.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_guest_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_require_approval boolean;
  v_duration         int;
BEGIN
  -- Trusted contexts may set privileged fields directly.
  --   auth.role() = 'service_role'  -> payment-webhook (online fulfilment)
  --   is_superadmin()               -> platform admin
  --   member of NEW.org_id          -> dashboard admin manual entry
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  -- Untrusted (guest) insert. The service must belong to THIS org and be active;
  -- pin the duration from it so a tampered client can't set an arbitrary length
  -- or borrow another org's service_id.
  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = NEW.service_id
     AND s.org_id = NEW.org_id
     AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;
  NEW.duration_minutes := v_duration;

  -- A named staff member must be bookable AND assigned to the service.
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = NEW.service_id
       AND ss.member_id = NEW.staff_id
       AND m.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  -- Pin the security-sensitive fields. A direct guest booking is always
  -- in-person + unpaid; online bookings are created only by the service-role
  -- webhook (exempt above). Initial status follows the org's approval setting.
  SELECT o.require_approval INTO v_require_approval
    FROM organisations o
   WHERE o.id = NEW.org_id;

  NEW.status            := CASE WHEN coalesce(v_require_approval, true)
                                THEN 'pending' ELSE 'approved' END;
  NEW.payment_status    := 'unpaid';
  NEW.payment_method    := 'in_person';
  NEW.payment_provider  := NULL;
  NEW.payment_reference := NULL;
  NEW.admin_notes       := NULL;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION normalize_guest_appointment IS
  'BEFORE INSERT on appointments: for guest inserts, validates service↔org and '
  'staff assignment, pins duration from the service, and pins status/payment '
  'fields. Trusted contexts (service_role, superadmin, org member) bypass.';

-- ------------------------------------------------------------
-- 6a. Image-only MIME allowlists on the public buckets (defense against serving
--     arbitrary/active content). SVG is intentionally excluded. Only affects new
--     uploads; existing objects are untouched.
-- ------------------------------------------------------------
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif']
 WHERE id IN ('logos','member-photos','service-images','catalog-images');

-- ------------------------------------------------------------
-- 6b. Move pg_trgm out of the public schema. It is relocatable; its GIN indexes
--     reference the opclass by OID and `extensions` is in the default
--     search_path, so trigram/ILIKE search keeps working.
-- ------------------------------------------------------------
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
