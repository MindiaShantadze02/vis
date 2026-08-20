-- ============================================================
-- 20260901120000_fix_lock_billable_definer.sql
--
-- REGRESSION FIX. lock_billable_appointment (the retro-cancel guard from
-- 20260824120000) began reading platform_config when the 24h grace window was
-- added in 20260825120000 — but it was declared WITHOUT SECURITY DEFINER, so it
-- ran as the CALLING role. `authenticated` has no SELECT on platform_config
-- (revoked in the 2026-08-19 grant sweep, because it holds SMS and payment
-- credentials).
--
-- Effect: EVERY owner-driven appointment status change failed with
--   42501: permission denied for table platform_config
-- — cancel, approve, decline, mark no-show. The entire dashboard workflow.
--
-- Two lessons worth keeping:
--   1. A trigger that reads a locked-down config table must be SECURITY DEFINER,
--      or it inherits the caller's (correctly minimal) rights.
--   2. The failing specs were first blamed on seed-calendar saturation, which
--      was ALSO true and masked this. When a plausible environmental
--      explanation exists, still reproduce the failure directly — one UPDATE as
--      the owner role surfaced this immediately.
-- ============================================================
CREATE OR REPLACE FUNCTION public.lock_billable_appointment()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_grace int;
  v_slot_end timestamptz;
BEGIN
  IF NOT (OLD.status IN ('approved','completed','no_show')
          AND (NEW.status NOT IN ('approved','completed','no_show')
               OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at)) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce((billing_config ->> 'retro_cancel_grace_hours')::int, 24)
    INTO v_grace FROM platform_config WHERE id = 1;

  v_slot_end := OLD.scheduled_at + make_interval(mins => coalesce(OLD.duration_minutes, 0));

  IF v_slot_end >= now() - make_interval(hours => coalesce(v_grace, 24)) THEN
    RETURN NEW;
  END IF;

  NEW.billable_locked_at := coalesce(OLD.billable_locked_at, now());
  NEW.billable_period_at := coalesce(OLD.billable_period_at, OLD.scheduled_at);
  RETURN NEW;
END;
$function$;
