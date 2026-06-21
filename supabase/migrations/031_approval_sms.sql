-- ============================================================
-- 031_approval_sms.sql
-- Run AFTER 030_booking_otp.sql. Supersedes the behavior added in 029.
--
-- 029 sent a booking_confirmation SMS on EVERY appointment insert. The new
-- flow only confirms once a GUEST booking is actually approved:
--   * online (auto-approved): at insert, status already 'approved'
--   * pay-in-person: stays 'pending', then the admin approves it (UPDATE)
-- Admin-created appointments (member insert) send nothing.
--
-- The customer's only SMS at booking time is the verification code (030);
-- this trigger handles the "approved + details" message (approval_update).
-- ============================================================

CREATE OR REPLACE FUNCTION send_appointment_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url    text;
  v_secret text;
  v_send   boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Guest booking that is approved immediately (online). Skip admin-created
    -- appointments: the inserting user is a member of the org.
    IF NEW.status = 'approved'
       AND NOT (auth.uid() IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_members m
                  WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()))
    THEN
      v_send := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Transition into 'approved' (e.g. admin approving a pending guest booking).
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      v_send := true;
    END IF;
  END IF;

  IF NOT v_send THEN
    RETURN NEW;
  END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'appointment_id', NEW.id,
                   'message_type', 'approval_update'
                 ),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-sms-secret', coalesce(v_secret, '')
                 )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_appointment_sms failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION send_appointment_sms IS
  'Sends the approval_update SMS (via the send-sms edge function / pg_net) when '
  'a guest booking reaches ''approved'': at insert for online bookings, at the '
  'approving UPDATE for in-person. Admin-created appointments send nothing.';

-- Retarget the trigger to also fire on UPDATE.
DROP TRIGGER IF EXISTS trg_send_appointment_sms ON appointments;
CREATE TRIGGER trg_send_appointment_sms
  AFTER INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION send_appointment_sms();
