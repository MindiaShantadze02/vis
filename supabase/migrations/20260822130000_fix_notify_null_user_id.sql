-- ============================================================
-- 20260822130000_fix_notify_null_user_id.sql
--
-- BUG (pre-existing, found while SQL-testing the approval re-add): an org that
-- has ever added a non-login staff profile gets NO booking notifications at all.
--
-- notify_new_appointment fans out with:
--     INSERT INTO notifications (..., user_id, ...)
--     SELECT ..., m.user_id, ... FROM org_members m WHERE m.org_id = NEW.org_id;
--
-- Staff profiles added since 061 are `org_members` rows with `user_id IS NULL`
-- (they are bookable people, not logins). `notifications.user_id` is NOT NULL,
-- so as soon as one such row exists the INSERT violates the constraint — and
-- because the whole block is wrapped in `EXCEPTION WHEN OTHERS THEN RAISE
-- WARNING` (added in 021 so a notification failure can never roll back a
-- booking), it fails silently. Not one member is notified, and nothing surfaces
-- in the app. The seed org reproduces it exactly: 2 members, 1 of them a
-- non-login staff profile.
--
-- The guard that made it invisible is still correct — a booking must never be
-- lost to a notification error — so the fix is simply to select only members who
-- can actually receive one.
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_new_appointment()
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
    WHERE m.org_id = NEW.org_id
      -- Non-login staff profiles (061) have no user_id and cannot be notified.
      -- Without this the NOT NULL violation kills the whole fan-out.
      AND m.user_id IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_new_appointment failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_new_appointment IS
  'AFTER INSERT on appointments: notifies every LOGIN member of the org '
  '(user_id IS NOT NULL — non-login staff profiles cannot receive one, and '
  'including them used to abort the entire fan-out on a NOT NULL violation). '
  'Type/title are ''pending_approval'' for a booking awaiting approval, else '
  '''new_appointment''. Skipped when a member of the org made the booking.';
