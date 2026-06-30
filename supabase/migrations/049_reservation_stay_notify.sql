-- ============================================================
-- 049_reservation_stay_notify.sql
-- Run AFTER 048_hotel_core.sql.
--
-- Brings restaurant_reservations and hotel_stays to parity with appointments
-- for new-booking signalling:
--   * In-app notification to the org's members (the dashboard bell) — mirrors
--     notify_new_appointment (021).
--   * Customer confirmation SMS via the send-sms edge function — mirrors
--     send_appointment_sms (029); no-op until sms_config.send_sms_url is set.
--
-- ADDITIVE: appointments triggers/functions are untouched. The notifications
-- row carries appointment_id = NULL for these (the bell only needs title/body
-- and routes to /dashboard, which shows the right vertical's overview).
-- ============================================================

-- Allow the two new notification types.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'new_appointment','pending_approval','appointment_cancelled',
    'new_reservation','new_stay'
  ));


-- ============================================================
-- IN-APP NOTIFICATIONS
-- ============================================================

CREATE OR REPLACE FUNCTION notify_new_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name text;
BEGIN
  -- Skip when an admin of THIS org created the reservation themselves.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
    INTO v_customer_name
    FROM customers c WHERE c.id = NEW.customer_id;

  BEGIN
    INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
    SELECT
      NEW.org_id, m.user_id, 'new_reservation', NULL,
      'ახალი ჯავშნის მოთხოვნა',
      concat_ws(' · ', v_customer_name,
        to_char(NEW.reserved_at AT TIME ZONE 'Asia/Tbilisi', 'DD Mon, HH24:MI'),
        NEW.party_size || ' სტუმარი')
    FROM org_members m WHERE m.org_id = NEW.org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_new_reservation failed for reservation %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_reservation
  AFTER INSERT ON restaurant_reservations
  FOR EACH ROW EXECUTE FUNCTION notify_new_reservation();


CREATE OR REPLACE FUNCTION notify_new_stay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name text;
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
    INTO v_customer_name
    FROM customers c WHERE c.id = NEW.customer_id;

  BEGIN
    INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
    SELECT
      NEW.org_id, m.user_id, 'new_stay', NULL,
      'ახალი ჯავშნის მოთხოვნა',
      concat_ws(' · ', v_customer_name,
        to_char(NEW.check_in, 'DD Mon') || ' – ' || to_char(NEW.check_out, 'DD Mon'),
        NEW.guests || ' სტუმარი')
    FROM org_members m WHERE m.org_id = NEW.org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_new_stay failed for stay %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_stay
  AFTER INSERT ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION notify_new_stay();


-- ============================================================
-- CONFIRMATION SMS (to the customer) — fire-and-forget via send-sms.
-- Mirrors send_appointment_sms (029): no-op when send_sms_url is unset.
-- The send-sms edge function is extended to accept reservation_id / stay_id.
-- ============================================================

CREATE OR REPLACE FUNCTION send_reservation_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url text; v_secret text;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret FROM platform_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN NEW; END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('reservation_id', NEW.id, 'message_type', 'booking_confirmation'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_reservation_sms failed for reservation %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_send_reservation_sms
  AFTER INSERT ON restaurant_reservations
  FOR EACH ROW EXECUTE FUNCTION send_reservation_sms();


CREATE OR REPLACE FUNCTION send_stay_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url text; v_secret text;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret FROM platform_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN NEW; END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('stay_id', NEW.id, 'message_type', 'booking_confirmation'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_stay_sms failed for stay %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_send_stay_sms
  AFTER INSERT ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION send_stay_sms();
