-- ============================================================
-- 025_max_advance_days.sql
-- Run AFTER 024_customer_name_letters.sql.
--
-- Lets an org cap how far in advance a customer may book
-- (e.g. "at most 30 days ahead"). Stored on working_hours_template
-- alongside the other booking-capacity settings.
--
-- NULL = no limit (the prior behaviour), so existing orgs are
-- unaffected until an admin sets a value.
--
-- Public bookings are inserted directly by the anonymous client
-- (Step3CustomerForm), so the only reliable server-side guard is a
-- BEFORE INSERT trigger on appointments. Admin manual entries
-- (AddAppointmentDialog) are exempt — staff may book any date.
-- ============================================================

ALTER TABLE working_hours_template
  ADD COLUMN max_advance_days int2
    CHECK (max_advance_days IS NULL OR max_advance_days > 0);

COMMENT ON COLUMN working_hours_template.max_advance_days IS
  'Max days in advance a customer may book. NULL = no limit. Enforced '
  'client-side (Step2DateTimeSelect) and server-side (enforce_booking_advance_window).';

-- Reject guest bookings whose date is beyond the org's advance window.
-- SECURITY DEFINER so it can read working_hours_template / org_members
-- regardless of the (anonymous) caller's RLS context.
CREATE OR REPLACE FUNCTION enforce_booking_advance_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max int2;
BEGIN
  -- Admins of THIS org (dashboard manual entry) are not restricted.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT max_advance_days INTO v_max
    FROM working_hours_template
   WHERE org_id = NEW.org_id;

  -- Compare calendar dates in the org's timezone (matches the day-based
  -- picker and get_available_slots, which both work in Asia/Tbilisi).
  IF v_max IS NOT NULL
     AND (NEW.scheduled_at AT TIME ZONE 'Asia/Tbilisi')::date
         > ((now() AT TIME ZONE 'Asia/Tbilisi')::date + v_max) THEN
    RAISE EXCEPTION 'booking_too_far_in_advance'
      USING HINT = 'scheduled_at exceeds the org max_advance_days window';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_booking_advance_window IS
  'BEFORE INSERT guard on appointments: blocks guest bookings dated beyond '
  'the org max_advance_days window. Skips appointments created by an admin of the org.';

CREATE TRIGGER trg_enforce_booking_advance_window
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_advance_window();
