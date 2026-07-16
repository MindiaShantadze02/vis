-- ============================================================
-- 085_sms_delivery_report.sql
-- Run AFTER 084_atomic_guest_booking.sql.
--
-- The SMS pipeline is fire-and-forget: pg_net posts to the send-sms edge
-- function and never reads the response, and dispatch_appointment_reminders
-- marks reminder_sent_at BEFORE posting (correct for dedupe, 039/072). If the
-- edge function is down or errors, the SMS is silently lost — nothing records
-- the gap.
--
-- This adds a superadmin reconciliation report that surfaces those losses
-- after the fact, from durable data (sms_log), not net._http_response (which
-- pg_net prunes within hours):
--   * reminder_gap    — reminder_sent_at is set but no appointment_reminder
--                       row ever landed in sms_log (the edge fn never ran or
--                       died before logging).
--   * failed_send     — the provider send ran and logged status='failed'.
--   * stuck_queued    — a log row still 'queued' well past any plausible
--                       in-flight window (edge fn died mid-send).
--
-- A 15-minute grace period keeps in-flight reminders out of the report.
-- Read-only; superadmin-gated like org_usage_info (066) / platform_stats.
-- ============================================================

CREATE OR REPLACE FUNCTION sms_delivery_report(
  p_since timestamptz DEFAULT now() - interval '7 days'
)
RETURNS TABLE (
  kind           text,
  org_id         uuid,
  appointment_id uuid,
  message_type   text,
  detail         text,
  occurred_at    timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY

  -- Reminders the cron marked as sent but that never reached sms_log.
  SELECT 'reminder_gap'::text,
         a.org_id,
         a.id,
         'appointment_reminder'::text,
         'reminder_sent_at set, no sms_log row'::text,
         a.reminder_sent_at
    FROM appointments a
   WHERE a.reminder_sent_at >= p_since
     AND a.reminder_sent_at < now() - interval '15 minutes'
     AND NOT EXISTS (
       SELECT 1
         FROM sms_log l
        WHERE l.appointment_id = a.id
          AND l.message_type = 'appointment_reminder'
     )

  UNION ALL

  -- Provider-level failures (logged by the send-sms edge function).
  SELECT 'failed_send'::text,
         l.org_id,
         l.appointment_id,
         l.message_type,
         coalesce(l.error, 'provider send failed')::text,
         l.created_at
    FROM sms_log l
   WHERE l.created_at >= p_since
     AND l.status = 'failed'

  UNION ALL

  -- Rows stuck in 'queued': the edge fn logged the attempt then died mid-send.
  SELECT 'stuck_queued'::text,
         l.org_id,
         l.appointment_id,
         l.message_type,
         'still queued'::text,
         l.created_at
    FROM sms_log l
   WHERE l.created_at >= p_since
     AND l.created_at < now() - interval '15 minutes'
     AND l.status = 'queued'

  ORDER BY 6 DESC;
END;
$$;

COMMENT ON FUNCTION sms_delivery_report IS
  'Superadmin SMS-loss reconciliation: reminders marked sent with no sms_log '
  'row (pg_net/edge-fn drop), provider failures, and rows stuck in queued. '
  '15-minute grace period excludes in-flight sends. Raises not_authorized for '
  'non-superadmins.';

REVOKE EXECUTE ON FUNCTION sms_delivery_report(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sms_delivery_report(timestamptz) TO authenticated;
