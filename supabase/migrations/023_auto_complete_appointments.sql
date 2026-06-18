-- ============================================================
-- 023_auto_complete_appointments.sql
-- Run AFTER 022_field_validation.sql.
--
-- Once an approved appointment's time window has elapsed it should
-- become 'completed' automatically — without anyone clicking. The
-- window ends at scheduled_at + duration_minutes; after that the
-- visit is over.
--
-- Driven by pg_cron (a real time-based trigger) rather than a
-- per-view update, so completion happens whether or not anyone has
-- the dashboard open. The notification trigger (020/021) is AFTER
-- INSERT only, so these UPDATEs do not fan out any notifications.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Flip every approved appointment whose end time has passed to completed.
-- SECURITY DEFINER so the cron job (runs as the postgres role) bypasses RLS.
CREATE OR REPLACE FUNCTION complete_elapsed_appointments()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE appointments
     SET status = 'completed'
   WHERE status = 'approved'
     AND scheduled_at + make_interval(mins => duration_minutes::int) <= now();
$$;

COMMENT ON FUNCTION complete_elapsed_appointments IS
  'Marks approved appointments as completed once scheduled_at + duration_minutes '
  'has passed. Invoked every 5 minutes by the complete-elapsed-appointments cron job.';

-- (Re)schedule the job idempotently — unschedule first so re-running this
-- migration does not error on a duplicate job name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'complete-elapsed-appointments') THEN
    PERFORM cron.unschedule('complete-elapsed-appointments');
  END IF;

  PERFORM cron.schedule(
    'complete-elapsed-appointments',
    '*/5 * * * *',
    $cron$ SELECT complete_elapsed_appointments(); $cron$
  );
END;
$$;

-- Backfill: complete any already-elapsed approved appointment right now,
-- rather than waiting for the first cron tick.
SELECT complete_elapsed_appointments();
