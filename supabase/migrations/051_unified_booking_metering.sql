-- ============================================================
-- 051_unified_booking_metering.sql
-- Run AFTER 050_reservation_stay_approval_sms.sql.
--
-- Makes the monthly subscription limit count ALL bookings, not just
-- appointments: a restaurant reservation and a hotel stay each consume one
-- unit of monthly quota, same as an appointment.
--
-- 013 derives usage from the appointments table (org_usage) and 028 enforces it
-- on appointment inserts (enforce_appointment_limit, which only reads NEW.org_id
-- and is therefore vertical-agnostic). Here we:
--   1. Redefine org_usage() to also count restaurant_reservations + hotel_stays
--      created in the current billing period (excluding terminal statuses).
--   2. Attach the existing enforce_appointment_limit() as a BEFORE INSERT guard
--      on those two tables (same reuse trick as enforce_booking_verification).
--
-- org_can_accept_appointment() / org_usage_info() consume org_usage(), so the
-- pre-checks (BookingLayout, create-payment) and the dashboard usage bar all
-- reflect the combined count with no other changes.
-- ============================================================

CREATE OR REPLACE FUNCTION org_usage(p_org_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT (
    (SELECT COUNT(*)
       FROM appointments a
       JOIN organisations o ON o.id = a.org_id
      WHERE a.org_id = p_org_id
        AND a.status NOT IN ('rejected', 'cancelled')
        AND a.created_at >= current_period_start(o.usage_anchor))
    +
    (SELECT COUNT(*)
       FROM restaurant_reservations r
       JOIN organisations o ON o.id = r.org_id
      WHERE r.org_id = p_org_id
        AND r.status NOT IN ('rejected', 'cancelled', 'no_show')
        AND r.created_at >= current_period_start(o.usage_anchor))
    +
    (SELECT COUNT(*)
       FROM hotel_stays s
       JOIN organisations o ON o.id = s.org_id
      WHERE s.org_id = p_org_id
        AND s.status NOT IN ('rejected', 'cancelled', 'no_show')
        AND s.created_at >= current_period_start(o.usage_anchor))
  )::int;
$$;

COMMENT ON FUNCTION org_usage IS
  'Bookings created in the org''s current billing period across all verticals '
  '(appointments + restaurant_reservations + hotel_stays), excluding terminal '
  'statuses. Drives org_can_accept_appointment / org_usage_info.';

-- Enforce the same tier limit on reservation/stay inserts. enforce_appointment_limit()
-- only references NEW.org_id, so it applies unchanged to these tables too.
CREATE TRIGGER trg_enforce_reservation_limit
  BEFORE INSERT ON restaurant_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_appointment_limit();

CREATE TRIGGER trg_enforce_stay_limit
  BEFORE INSERT ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION enforce_appointment_limit();
