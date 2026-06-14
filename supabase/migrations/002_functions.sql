-- ============================================================
-- 002_functions.sql
-- Run AFTER 001_tables.sql.
-- Helper functions used by RLS policies and application logic.
-- ============================================================


-- ============================================================
-- AUTH HELPER FUNCTIONS
-- SECURITY DEFINER: run as postgres, bypasses RLS.
-- This is intentional — these functions need to read tables
-- (org_members, platform_config) without triggering their
-- own RLS policies, which would cause circular evaluation.
-- ============================================================

-- Returns all org IDs where the calling user is a member.
-- Used in every org-scoped RLS SELECT policy.
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT ARRAY(
    SELECT org_id
    FROM org_members
    WHERE user_id = auth.uid()
  );
$$;

-- Returns the calling user's role in a specific org ('owner', 'admin', or NULL).
-- Used in RLS policies that distinguish owner vs admin permissions.
CREATE OR REPLACE FUNCTION get_user_org_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role
  FROM org_members
  WHERE user_id = auth.uid()
    AND org_id = p_org_id
  LIMIT 1;
$$;

-- Returns true if the calling user is the platform superadmin.
-- Superadmin user_id is stored in platform_config to allow
-- changing it without a code deploy.
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT superadmin_user_id = auth.uid()
     FROM platform_config
     WHERE id = 1),
    false
  );
$$;


-- ============================================================
-- UPDATED_AT TRIGGER
-- Automatically stamps updated_at on UPDATE for relevant tables.
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER working_hours_template_updated_at
  BEFORE UPDATE ON working_hours_template
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER platform_config_updated_at
  BEFORE UPDATE ON platform_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- SLOT AVAILABILITY HELPER
-- Called by the get-available-slots Edge Function.
-- Returns available slot start times for a given org + service
-- on a specific date, taking working hours and existing
-- appointments into account.
-- ============================================================

CREATE OR REPLACE FUNCTION get_available_slots(
  p_org_id     uuid,
  p_service_id uuid,
  p_date       date
)
RETURNS TABLE (slot_start timestamptz, available_count int2)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_template    working_hours_template%ROWTYPE;
  v_override    working_hours_overrides%ROWTYPE;
  v_service     services%ROWTYPE;
  v_day_data    jsonb;
  v_ranges      jsonb;
  v_range       jsonb;
  v_range_start time;
  v_range_end   time;
  v_candidate   timestamptz;
  v_slot_end    timestamptz;
  v_day_name    text;
  v_booked      int2;
BEGIN
  -- Load service to get duration
  SELECT * INTO v_service FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Load working hours template
  SELECT * INTO v_template FROM working_hours_template WHERE org_id = p_org_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Check for a per-date override
  SELECT * INTO v_override
  FROM working_hours_overrides
  WHERE org_id = p_org_id AND date = p_date;

  IF FOUND AND v_override.is_closed THEN
    RETURN; -- Closed on this date
  END IF;

  -- Determine which ranges to use
  IF FOUND AND v_override.ranges IS NOT NULL THEN
    v_ranges := v_override.ranges;
  ELSE
    -- Use the weekly template for this day of week
    v_day_name := lower(to_char(p_date, 'Day'));
    v_day_name := trim(v_day_name);

    v_day_data := CASE v_day_name
      WHEN 'monday'    THEN v_template.monday
      WHEN 'tuesday'   THEN v_template.tuesday
      WHEN 'wednesday' THEN v_template.wednesday
      WHEN 'thursday'  THEN v_template.thursday
      WHEN 'friday'    THEN v_template.friday
      WHEN 'saturday'  THEN v_template.saturday
      WHEN 'sunday'    THEN v_template.sunday
    END;

    IF (v_day_data->>'open')::boolean IS NOT TRUE THEN
      RETURN; -- Closed on this day of week
    END IF;

    v_ranges := v_day_data->'ranges';
  END IF;

  -- Generate candidate slots for each time range
  FOR v_range IN SELECT * FROM jsonb_array_elements(v_ranges)
  LOOP
    v_range_start := (v_range->>'start')::time;
    v_range_end   := (v_range->>'end')::time;
    v_candidate   := (p_date + v_range_start) AT TIME ZONE 'Asia/Tbilisi';

    WHILE v_candidate + (v_service.duration_minutes || ' minutes')::interval
          <= (p_date + v_range_end) AT TIME ZONE 'Asia/Tbilisi'
    LOOP
      v_slot_end := v_candidate + (v_service.duration_minutes || ' minutes')::interval;

      -- Count overlapping non-cancelled appointments
      SELECT COUNT(*)::int2 INTO v_booked
      FROM appointments
      WHERE org_id = p_org_id
        AND scheduled_at < v_slot_end
        AND (scheduled_at + (duration_minutes || ' minutes')::interval) > v_candidate
        AND status NOT IN ('rejected','cancelled');

      IF v_booked < v_template.max_appointments_per_slot THEN
        slot_start      := v_candidate;
        available_count := (v_template.max_appointments_per_slot - v_booked)::int2;
        RETURN NEXT;
      END IF;

      v_candidate := v_candidate + (v_template.slot_duration_minutes || ' minutes')::interval;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION get_available_slots IS
  'Returns available booking slots for an org + service on a given date. '
  'Respects working_hours_template and working_hours_overrides. '
  'Called by the get-available-slots Edge Function.';


-- ============================================================
-- APPOINTMENT LIMIT CHECK
-- Returns true if the org has room for another appointment
-- this month under their current subscription tier.
-- ============================================================

CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    CASE
      WHEN o.subscription_tier = 'business' THEN true
      WHEN (pc.tier_limits ->> o.subscription_tier)::int IS NULL THEN true
      ELSE o.appointments_used_this_month < (pc.tier_limits ->> o.subscription_tier)::int
    END
  FROM organisations o
  CROSS JOIN platform_config pc
  WHERE o.id = p_org_id AND pc.id = 1;
$$;
