-- ============================================================
-- 050_reservation_stay_approval_sms.sql
-- Run AFTER 049_reservation_stay_notify.sql. Supersedes the SMS behavior 049
-- added for restaurant_reservations / hotel_stays (mirrors how 031 superseded
-- 029 for appointments).
--
-- 049 texted the customer a confirmation on EVERY reservation/stay insert — but
-- guest bookings insert as 'pending', so that confirmed a booking the owner
-- hadn't accepted yet. Appointments deliberately don't do this: the customer's
-- only message at booking time is the OTP code, and the "approved + details"
-- SMS (approval_update) is sent once the booking actually reaches 'approved'.
--
-- This retargets the send_*_sms triggers to fire on the approving transition
-- instead of on insert. The in-app bell notification (049) still fires on
-- insert — that's the owner-facing "new request" signal and is correct.
-- No-op until platform_config.sms_config.send_sms_url is set.
-- ============================================================

CREATE OR REPLACE FUNCTION send_reservation_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url text; v_secret text; v_send boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Guest booking already approved at insert (not the current flow, but be safe).
    IF NEW.status = 'approved'
       AND NOT (auth.uid() IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_members m WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()))
    THEN v_send := true; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN v_send := true; END IF;
  END IF;

  IF NOT v_send THEN RETURN NEW; END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret FROM platform_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN NEW; END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('reservation_id', NEW.id, 'message_type', 'approval_update'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_reservation_sms failed for reservation %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_send_reservation_sms ON restaurant_reservations;
CREATE TRIGGER trg_send_reservation_sms
  AFTER INSERT OR UPDATE ON restaurant_reservations
  FOR EACH ROW EXECUTE FUNCTION send_reservation_sms();


CREATE OR REPLACE FUNCTION send_stay_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url text; v_secret text; v_send boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved'
       AND NOT (auth.uid() IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_members m WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()))
    THEN v_send := true; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN v_send := true; END IF;
  END IF;

  IF NOT v_send THEN RETURN NEW; END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret FROM platform_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN NEW; END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('stay_id', NEW.id, 'message_type', 'approval_update'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_stay_sms failed for stay %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_send_stay_sms ON hotel_stays;
CREATE TRIGGER trg_send_stay_sms
  AFTER INSERT OR UPDATE ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION send_stay_sms();
