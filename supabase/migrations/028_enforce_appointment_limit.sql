-- ============================================================
-- 028_enforce_appointment_limit.sql
-- Run AFTER 027_cascade_org_delete.sql.
--
-- Enforces the org's monthly subscription appointment quota at
-- creation time.
--
-- Usage accounting and the limit check already exist (migration 013:
-- org_usage / org_can_accept_appointment, read against
-- platform_config.tier_limits). The book-appointment edge function
-- checks it, but neither real insert path goes through that function:
-- both guest bookings (Step3CustomerForm) and admin manual entries
-- (AddAppointmentDialog) insert into appointments DIRECTLY from the
-- client, and the RLS insert policy is WITH CHECK (true). So nothing
-- actually blocked an org from booking past its paid tier.
--
-- A BEFORE INSERT trigger is the only reliable server-side guard for
-- direct client inserts (same reasoning as enforce_booking_advance_window
-- in migration 025). Unlike that trigger, this one does NOT exempt org
-- admins: manual entries count toward usage, so exempting them would let
-- the business bypass its own quota.
-- ============================================================

-- Fix the stale comment from 004_rls.sql which still references the
-- hand-maintained appointments_used_this_month counter dropped in 013.
COMMENT ON POLICY "appointments_public_insert" ON appointments IS
  'Guest booking inserts directly. Tier/slot rules are enforced by '
  'BEFORE INSERT triggers (enforce_appointment_limit, '
  'enforce_booking_advance_window); usage is derived from this table.';

-- Reject any insert once the org has reached its tier limit. SECURITY
-- DEFINER so org_can_accept_appointment can read organisations /
-- platform_config regardless of the (possibly anonymous) caller's RLS.
CREATE OR REPLACE FUNCTION enforce_appointment_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- COALESCE(..., true): a NULL means the org wasn't found; the FK on
  -- appointments.org_id guarantees it exists, so don't wrongly block.
  -- A null tier limit (e.g. business) makes the check return true =>
  -- unlimited.
  IF NOT COALESCE(org_can_accept_appointment(NEW.org_id), true) THEN
    RAISE EXCEPTION 'limit_reached'
      USING HINT = 'org has reached its subscription_tier appointment limit';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_appointment_limit IS
  'BEFORE INSERT guard on appointments: blocks creation once the org has '
  'reached its tier limit (org_can_accept_appointment). Applies to all '
  'callers, including org admins. Raises ''limit_reached''.';

CREATE TRIGGER trg_enforce_appointment_limit
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_appointment_limit();
