-- ============================================================
-- 039_appointment_reminders.sql
-- Run AFTER 038_password_reset_otp.sql.
--
-- Automated appointment reminders — the biggest no-show reducer. A pg_cron job
-- (like 023's auto-complete) finds approved appointments entering the reminder
-- window and dispatches a reminder SMS through the SAME pipeline as booking
-- confirmations: net.http_post → send-sms edge function → the pluggable
-- SmsProvider (mock today, a real Georgian gateway later). No provider wiring is
-- needed here; when one is configured this starts delivering automatically.
--
-- Design:
--   * One reminder per appointment, ~24h before start (REMINDER_LEAD below).
--   * reminder_sent_at dedupes so a reminder is never sent twice.
--   * If the SMS URL isn't configured yet, the job no-ops (nothing is marked),
--     so reminders simply begin once a provider/url exists.
-- ============================================================

-- Tracks that (and when) a reminder was dispatched, so the cron never re-sends.
ALTER TABLE appointments ADD COLUMN reminder_sent_at timestamptz;

COMMENT ON COLUMN appointments.reminder_sent_at IS
  'When the ~24h-before reminder SMS was dispatched (NULL = not yet). Set by the '
  'dispatch_appointment_reminders cron to dedupe sends.';

-- Partial index: the cron only ever scans approved, not-yet-reminded rows.
CREATE INDEX idx_appointments_reminder_due
  ON appointments (scheduled_at)
  WHERE status = 'approved' AND reminder_sent_at IS NULL;

-- Allow the new SMS type in the audit log (mirrors SmsMessageType in
-- _shared/sms/types.ts).
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation','approval_update',
    'admin_new_booking','admin_reminder','invitation',
    'verification_code','appointment_reminder'
  ));

-- --------------------------------------------------------
-- Dispatch reminders for approved appointments that have entered the lead
-- window and haven't been reminded yet. Mirrors the http_post pattern in
-- send_appointment_sms (031): reads the send-sms URL + secret from
-- platform_config and fires one fire-and-forget request per appointment.
-- SECURITY DEFINER so the cron job (postgres role) bypasses RLS.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  -- How far before start the reminder goes out. Change here to retune.
  REMINDER_LEAD constant interval := interval '24 hours';
  v_url    text;
  v_secret text;
  r        record;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  -- No SMS endpoint configured yet → do nothing (and don't mark rows), so
  -- reminders start cleanly once a provider/url is set.
  IF v_url IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id
      FROM appointments
     WHERE status = 'approved'
       AND reminder_sent_at IS NULL
       AND scheduled_at > now()
       AND scheduled_at <= now() + REMINDER_LEAD
  LOOP
    -- Mark first so a slow/failed post can't cause a duplicate on the next tick
    -- (fire-and-forget, same contract as the confirmation trigger).
    UPDATE appointments SET reminder_sent_at = now() WHERE id = r.id;

    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object(
                     'appointment_id', r.id,
                     'message_type', 'appointment_reminder'
                   ),
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-sms-secret', coalesce(v_secret, '')
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch_appointment_reminders failed for appointment %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION dispatch_appointment_reminders IS
  'Sends a one-time ~24h-before reminder SMS (via send-sms / pg_net) for each '
  'approved upcoming appointment, deduped by reminder_sent_at. Invoked every 15 '
  'minutes by the dispatch-appointment-reminders cron job.';

-- (Re)schedule idempotently — unschedule first so re-running doesn't error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-appointment-reminders') THEN
    PERFORM cron.unschedule('dispatch-appointment-reminders');
  END IF;

  PERFORM cron.schedule(
    'dispatch-appointment-reminders',
    '*/15 * * * *',
    $cron$ SELECT dispatch_appointment_reminders(); $cron$
  );
END;
$$;
