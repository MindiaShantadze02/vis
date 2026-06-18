-- ============================================================
-- 021_appointment_notifications_guard.sql
-- Run AFTER 020_appointment_notifications.sql.
--
-- 020 suppressed notifications for any authenticated insert
-- (auth.uid() IS NOT NULL). That's too blunt: it also skips a booking
-- made by a signed-in user who is NOT an admin of the org — and, in
-- practice, any testing done while logged into the dashboard.
--
-- The real intent is only to skip an appointment an admin of THIS org
-- created themselves (AddAppointmentDialog manual entry). So gate on org
-- membership of the inserting user instead. Guest/customer bookings
-- (auth.uid() null, or a signed-in non-member) always notify the org's
-- admins.
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
  -- Skip only when an admin of THIS org created the appointment themselves.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id
      AND m.user_id = auth.uid()
  ) THEN
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

  -- A failure here must never roll back the booking itself.
  BEGIN
    INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
    SELECT
      NEW.org_id,
      m.user_id,
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

-- Re-run the idempotent backfill to catch any pending booking that the
-- 020 guard skipped (e.g. bookings made while logged in).
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
