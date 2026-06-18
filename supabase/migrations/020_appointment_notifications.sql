-- ============================================================
-- 020_appointment_notifications.sql
-- Run AFTER 019_notifications_realtime.sql.
--
-- Public bookings are inserted into `appointments` directly by the
-- anonymous client (see Step3CustomerForm), not through an Edge Function,
-- and RLS forbids that client from writing `notifications`. So the only
-- reliable place to fan a new booking out to the org's admins is a
-- SECURITY DEFINER trigger on the appointments table — it runs as the
-- function owner and bypasses RLS to insert one notification per member.
--
-- Scoped to guest bookings (auth.uid() IS NULL): appointments an admin
-- enters manually via AddAppointmentDialog are made while authenticated,
-- and that admin already knows about them — no notification needed.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_new_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name text;
  v_service_name  text;
BEGIN
  -- Only public/guest bookings. Authenticated inserts are admin-made.
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
    INTO v_customer_name
    FROM customers c
   WHERE c.id = NEW.customer_id;

  SELECT s.name
    INTO v_service_name
    FROM services s
   WHERE s.id = NEW.service_id;

  -- A failure here must never roll back the booking itself, so swallow any
  -- error and let the appointment insert succeed regardless.
  BEGIN
    INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
    SELECT
      NEW.org_id,
      m.user_id,
      -- In-person bookings land as 'pending' and need approval; online-paid
      -- ones are auto-approved but still worth surfacing.
      CASE WHEN NEW.status = 'pending' THEN 'pending_approval' ELSE 'new_appointment' END,
      NEW.id,
      CASE WHEN NEW.status = 'pending' THEN 'ახალი ჯავშნის მოთხოვნა' ELSE 'ახალი ჯავშანი' END,
      concat_ws(' · ', v_customer_name, v_service_name)
    FROM org_members m
    WHERE m.org_id = NEW.org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_new_appointment failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_new_appointment IS
  'AFTER INSERT trigger on appointments: fans a guest booking out to every '
  'org_member as a notification row. SECURITY DEFINER to bypass RLS; skips '
  'authenticated (admin-made) inserts.';

CREATE TRIGGER trg_notify_new_appointment
  AFTER INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_appointment();

-- Backfill: seed a notification for every currently-pending booking so the
-- bell reflects outstanding requests right away, not only bookings made after
-- this migration. Idempotent — skips any (appointment, member) pair that
-- already has one.
INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
SELECT
  a.org_id,
  m.user_id,
  'pending_approval',
  a.id,
  'ახალი ჯავშნის მოთხოვნა',
  concat_ws(' · ',
    nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
    s.name)
FROM appointments a
JOIN org_members m ON m.org_id = a.org_id
LEFT JOIN customers c ON c.id = a.customer_id
LEFT JOIN services  s ON s.id = a.service_id
WHERE a.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.appointment_id = a.id
      AND n.user_id = m.user_id
  );
