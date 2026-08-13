-- ============================================================
-- 20260813130000_customer_sms_policy.sql
-- Run AFTER 20260813120000_remove_recurring.sql.
--
-- Pins the DB-driven customer SMS (trigger + cron) to exactly two messages:
--
--   1. ONE confirmation, when the booking becomes confirmed.
--   2. ONE reminder, on the MORNING OF the appointment day.
--
-- SCOPE: this covers only messages sent through the appointments trigger and the
-- reminder cron. Edge functions call sendSms DIRECTLY and are untouched here —
-- manage-appointment (reschedule_update / cancellation_update), refund-payment +
-- payment-webhook (refund_update), the OTP functions (verification_code), and
-- the owner-triggered meeting_link. A customer rescheduling or cancelling via
-- /manage therefore still gets their one message from that path.
--
-- Two things were off before:
--
--   * 095 replaced send_appointment_sms with a body carrying NO TG_OP / status
--     gating, while the trigger has been AFTER INSERT OR UPDATE since 031. Every
--     write to an appointment row — approve, cancel, no-show, admin note,
--     meeting link, the auto-complete cron — therefore fired another
--     "booking confirmed" text (the send-sms 60s cooldown only collapses bursts).
--     This restores 031's gating.
--   * Reminders went out on a 24h lead, i.e. the DAY BEFORE. They now go out on
--     the day itself.
-- ============================================================

-- --------------------------------------------------------
-- 1. Confirmation — exactly once, on reaching 'approved'.
--    INSERT: a booking that lands already approved (the normal path: the
--            payment webhook / API create approved rows). Rows inserted by an
--            org member are excluded — that is how 031 avoided texting for
--            owner-entered bookings, and it keeps any service-desk tooling
--            silent by default.
--    UPDATE: the pending → approved transition (owner approves a booking on a
--            require_approval org). Every other UPDATE is silent.
-- --------------------------------------------------------
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
    IF NEW.status = 'approved'
       AND NOT (auth.uid() IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_members m
                   WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()))
    THEN
      v_send := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
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
      body    := jsonb_build_object('appointment_id', NEW.id, 'message_type', 'booking_confirmation'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_appointment_sms failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION send_appointment_sms IS
  'Sends ONE booking_confirmation SMS when a booking reaches ''approved'' — at '
  'insert for auto-approved bookings, at the approving UPDATE otherwise. Every '
  'other appointment write (cancel, no-show, notes, meeting link, auto-complete) '
  'is silent.';

-- --------------------------------------------------------
-- 2. Reminder — the morning of the appointment, not the day before.
--
--    A row qualifies when it is still upcoming, sits on TODAY's business date
--    (Asia/Tbilisi, the domain timezone), and business time has passed
--    REMINDER_HOUR. The cron ticks every 15 minutes, so the first tick after
--    08:00 business time dispatches the day's reminders.
--
--    Consequences worth knowing:
--      * An appointment starting BEFORE REMINDER_HOUR gets no reminder — the
--        window would open after it began. Lower the constant if a business
--        opens earlier than 08:00.
--      * A booking made on the same day it happens gets no reminder: the
--        customer just received the confirmation, and a reminder hours later
--        reads as duplicate noise.
--    reminder_sent_at still dedupes (marked before posting, as before), and
--    billing-suspended orgs are still skipped.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  -- Business-time hour the reminder window opens. Retune here.
  REMINDER_HOUR constant int := 8;
  v_url    text;
  v_secret text;
  v_today  date;
  r        record;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret FROM platform_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN; END IF;

  -- Nothing to do until the window opens.
  IF extract(hour FROM (now() AT TIME ZONE 'Asia/Tbilisi')) < REMINDER_HOUR THEN
    RETURN;
  END IF;
  v_today := (now() AT TIME ZONE 'Asia/Tbilisi')::date;

  FOR r IN
    SELECT a.id
      FROM appointments a
      JOIN organisations o ON o.id = a.org_id
     WHERE a.status = 'approved'
       AND a.reminder_sent_at IS NULL
       AND a.scheduled_at > now()
       AND (a.scheduled_at AT TIME ZONE 'Asia/Tbilisi')::date = v_today
       AND (a.created_at   AT TIME ZONE 'Asia/Tbilisi')::date < v_today
       AND o.billing_status <> 'suspended'
  LOOP
    UPDATE appointments SET reminder_sent_at = now() WHERE id = r.id;
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object('appointment_id', r.id, 'message_type', 'appointment_reminder'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch_appointment_reminders failed for appointment %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION dispatch_appointment_reminders IS
  'Sends a one-time reminder SMS on the MORNING OF each upcoming appointment '
  '(business timezone, window opens 08:00), skipping same-day bookings and '
  'billing-suspended orgs. Deduped by reminder_sent_at; run every 15 minutes by '
  'the dispatch-appointment-reminders cron job.';

-- 073 revoked the default PUBLIC/anon EXECUTE on this cron helper; CREATE OR
-- REPLACE keeps existing grants, but re-assert it so the intent stays visible.
REVOKE ALL ON FUNCTION public.dispatch_appointment_reminders() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------
-- 3. Moving a booking re-arms its reminder. reminder_sent_at is a one-shot
--    dedupe flag; without this, an appointment reminded this morning and then
--    rescheduled to next week would never be reminded again. Covers every
--    reschedule path (owner, /manage self-service, API) since it sits on the
--    table rather than in one RPC. The dispatcher's own mark (which only writes
--    reminder_sent_at) doesn't trip it.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION clear_reminder_on_reschedule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION clear_reminder_on_reschedule IS
  'Clears reminder_sent_at when an appointment is moved, so the rescheduled date '
  'gets its own morning-of reminder.';
REVOKE ALL ON FUNCTION public.clear_reminder_on_reschedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clear_reminder_on_reschedule ON appointments;
CREATE TRIGGER trg_clear_reminder_on_reschedule
  BEFORE UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION clear_reminder_on_reschedule();
