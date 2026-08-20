-- ============================================================
-- 20260825120000_retro_cancel_grace_and_stats.sql
--
-- Two follow-ups to the retro-cancel lock in 20260824120000.
--
-- (a) GRACE WINDOW. The lock fired the instant an appointment elapsed, which
--     caught honest corrections as well as evasion: a customer who rings at
--     13:55 to cancel a 14:00 slot leaves the owner marking it cancelled at
--     15:30, and that was billed. A business now has grace_hours after the slot
--     ENDS to correct the record for free. Honest admin happens within hours;
--     month-end evasion happens weeks later, so the two separate cleanly on
--     time. Tunable from platform_config so the window can change without a
--     migration.
--
-- (b) VISIBILITY. A policy nobody can observe is not a policy — without this you
--     cannot tell an honest correction rate from an org probing where the line
--     is. platform_retro_cancel_stats reports late cancels against total
--     bookings, per org, superadmin only.
-- ============================================================

UPDATE platform_config
   SET billing_config = billing_config || '{"retro_cancel_grace_hours": 24}'::jsonb
 WHERE id = 1;

-- ⚠️ SECURITY DEFINER is REQUIRED, not optional: this reads platform_config for
-- the grace setting, and `authenticated` has no SELECT there (revoked in the
-- 2026-08-19 grant sweep — it holds SMS and payment credentials). Without it,
-- every owner status change fails with 42501 and the whole dashboard workflow
-- breaks. Shipped without it once; see 20260901120000.
CREATE OR REPLACE FUNCTION public.lock_billable_appointment()
  RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_grace int;
  v_slot_end timestamptz;
BEGIN
  -- Only a billable -> non-billable move, or a move of the slot itself, can
  -- reduce the bill. Everything else exits before touching platform_config.
  IF NOT (OLD.status IN ('approved','completed','no_show')
          AND (NEW.status NOT IN ('approved','completed','no_show')
               OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at)) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce((billing_config ->> 'retro_cancel_grace_hours')::int, 24)
    INTO v_grace FROM platform_config WHERE id = 1;

  v_slot_end := OLD.scheduled_at + make_interval(mins => coalesce(OLD.duration_minutes, 0));

  -- Inside the grace window (or still in the future) this is a correction, not
  -- an evasion: leave it unbilled.
  IF v_slot_end >= now() - make_interval(hours => coalesce(v_grace, 24)) THEN
    RETURN NEW;
  END IF;

  NEW.billable_locked_at := coalesce(OLD.billable_locked_at, now());
  NEW.billable_period_at := coalesce(OLD.billable_period_at, OLD.scheduled_at);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.lock_billable_appointment IS
  'Stamps an appointment as still-billable when it is downgraded or moved AFTER '
  'its slot ended plus platform_config.billing_config->retro_cancel_grace_hours '
  '(default 24). Inside the window, corrections are free.';

-- ── Superadmin visibility ─────────────────────────────────────────────────
-- Definitions, scoped to appointments whose slot falls in the window:
--   bookings          every appointment the org took (the denominator)
--   billable          what Vis charges for (live billable status, or locked)
--   retro_billed      cancelled/moved AFTER grace -> still charged. The signal.
--   free_corrections  cancelled/moved after the slot but INSIDE grace -> free.
--                     Expected to be small and steady for an honest business.
CREATE OR REPLACE FUNCTION public.platform_retro_cancel_stats(p_days int DEFAULT 90)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_from  timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 90), 1));
  v_grace int;
  v_out   jsonb;
BEGIN
  IF NOT coalesce(is_superadmin(), false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT coalesce((billing_config ->> 'retro_cancel_grace_hours')::int, 24)
    INTO v_grace FROM platform_config WHERE id = 1;

  WITH scoped AS (
    SELECT a.org_id,
           (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL) AS is_billable,
           (a.billable_locked_at IS NOT NULL)                                                   AS retro_billed,
           (a.billable_locked_at IS NULL
             AND a.status NOT IN ('approved','completed','no_show')
             AND a.scheduled_at + make_interval(mins => coalesce(a.duration_minutes,0)) < now()) AS free_correction
      FROM appointments a
     WHERE coalesce(a.billable_period_at, a.scheduled_at) >= v_from
       AND coalesce(a.billable_period_at, a.scheduled_at) <  now()
  ), per_org AS (
    SELECT o.id AS org_id, o.name, o.slug,
           count(*)::int                                   AS bookings,
           count(*) FILTER (WHERE s.is_billable)::int      AS billable,
           count(*) FILTER (WHERE s.retro_billed)::int     AS retro_billed,
           count(*) FILTER (WHERE s.free_correction)::int  AS free_corrections
      FROM organisations o
      JOIN scoped s ON s.org_id = o.id
     GROUP BY o.id, o.name, o.slug
  )
  SELECT jsonb_build_object(
           'window_days', greatest(coalesce(p_days, 90), 1),
           'grace_hours', v_grace,
           'totals', jsonb_build_object(
             'bookings',         coalesce(sum(bookings), 0),
             'billable',         coalesce(sum(billable), 0),
             'retro_billed',     coalesce(sum(retro_billed), 0),
             'free_corrections', coalesce(sum(free_corrections), 0),
             'orgs_affected',    count(*) FILTER (WHERE retro_billed > 0)
           ),
           'orgs', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'org_id', p.org_id, 'name', p.name, 'slug', p.slug,
                      'bookings', p.bookings, 'billable', p.billable,
                      'retro_billed', p.retro_billed,
                      'free_corrections', p.free_corrections,
                      'retro_rate_pct', CASE WHEN p.billable > 0
                                             THEN round(100.0 * p.retro_billed / p.billable, 1)
                                             ELSE 0 END)
                    ORDER BY p.retro_billed DESC, p.bookings DESC)
               FROM per_org p
              WHERE p.retro_billed > 0 OR p.free_corrections > 0
           ), '[]'::jsonb)
         )
    INTO v_out
    FROM per_org;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_retro_cancel_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_retro_cancel_stats(int) TO authenticated;
