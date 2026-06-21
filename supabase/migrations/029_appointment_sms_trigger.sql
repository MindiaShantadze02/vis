-- ============================================================
-- 029_appointment_sms_trigger.sql
-- Run AFTER 028_enforce_appointment_limit.sql.
--
-- Fires the outbound booking-confirmation SMS on every appointment
-- insert, regardless of how the booking was created (public booking
-- page direct-insert, admin manual entry, or the book-appointment edge
-- function). Mirrors the notify_new_appointment trigger (migration 021),
-- but instead of writing an in-app notification it asynchronously calls
-- the `send-sms` edge function, which builds the message and records it
-- in sms_log via the pluggable SMS provider (mock for now).
--
-- Delivery is decoupled from Postgres: actual sending lives in Deno where
-- a real gateway (and its SDK/credentials) can run. pg_net makes the call
-- fire-and-forget so a slow/offline SMS service never blocks or rolls back
-- the booking.
--
-- Config lives in platform_config.sms_config:
--   { "send_sms_url": "https://<ref>.functions.supabase.co/send-sms",
--     "webhook_secret": "<shared secret, also set as SMS_WEBHOOK_SECRET>" }
-- When unset, the trigger is a no-op (no SMS, no error).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION send_appointment_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  -- Not configured yet (e.g. local/dev) — skip silently.
  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget. A failure to enqueue must never roll back the booking.
  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'appointment_id', NEW.id,
                   'message_type', 'booking_confirmation'
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
  'AFTER INSERT on appointments: asynchronously calls the send-sms edge '
  'function (pg_net) to deliver a booking-confirmation SMS. No-op until '
  'platform_config.sms_config.send_sms_url is set.';

DROP TRIGGER IF EXISTS trg_send_appointment_sms ON appointments;
CREATE TRIGGER trg_send_appointment_sms
  AFTER INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION send_appointment_sms();
