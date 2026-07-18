-- ============================================================
-- remove_waitlist
-- Run AFTER 20260718090437_appointment_list_filters.
--
-- Removes the cancellation-waitlist feature (was migrations 093/094) and its
-- only feeder, slot_freed_events (092) — nothing else consumes freed-slot
-- events. The self-service manage flow (reschedule/cancel) is UNAFFECTED: it
-- never referenced slot_freed_events (that was an AFTER-UPDATE side effect for
-- the waitlist matcher).
--
-- Order matters: redefine get_org_analytics (drop its waitlist CTE) and drop
-- the functions BEFORE the tables they read, and unschedule the cron BEFORE
-- dropping the function it calls.
--
-- NOTE: the sms_log.message_type CHECK is left as-is — historical rows carry
-- 'waitlist_offer'/'waitlist_claimed', so narrowing it would reject them.
-- Nothing inserts those types anymore, so the extra allowed values are inert.
-- ============================================================

-- 1. Analytics no longer reports waitlist conversion. Same body as 096 minus
--    the `wl` CTE and the two waitlist keys.
CREATE OR REPLACE FUNCTION get_org_analytics(p_org_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH appts AS (
    SELECT a.status, a.customer_id, a.staff_id, a.payment_status, s.price,
           (a.scheduled_at AT TIME ZONE 'Asia/Tbilisi') AS local_at
      FROM appointments a
      JOIN services s ON s.id = a.service_id
     WHERE a.org_id = p_org_id
       AND (a.scheduled_at AT TIME ZONE 'Asia/Tbilisi')::date BETWEEN p_from AND p_to
  ),
  base AS (
    SELECT
      COALESCE(SUM(price) FILTER (WHERE status = 'completed'), 0)          AS revenue,
      COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'rejected'))      AS bookings,
      COUNT(*) FILTER (WHERE status = 'completed')                         AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled')                         AS cancelled,
      COUNT(*) FILTER (WHERE status = 'no_show')                           AS no_show,
      COUNT(*)                                                             AS total_all,
      COUNT(*) FILTER (WHERE payment_status IN ('paid', 'deposit_paid'))   AS deposits
    FROM appts
  ),
  staff_rev AS (
    SELECT COALESCE(m.display_name, '—') AS name, COALESCE(SUM(a.price), 0) AS revenue
      FROM appts a
      LEFT JOIN org_members m ON m.id = a.staff_id
     WHERE a.status = 'completed'
     GROUP BY 1 ORDER BY 2 DESC
  ),
  weekday AS (
    SELECT EXTRACT(isodow FROM local_at)::int AS d, COUNT(*) AS c
      FROM appts WHERE status NOT IN ('cancelled', 'rejected') GROUP BY 1
  ),
  hour AS (
    SELECT EXTRACT(hour FROM local_at)::int AS h, COUNT(*) AS c
      FROM appts WHERE status NOT IN ('cancelled', 'rejected') GROUP BY 1
  ),
  repeat_c AS (
    SELECT customer_id, COUNT(*) AS n FROM appts WHERE status = 'completed' GROUP BY 1
  )
  SELECT jsonb_build_object(
    'revenue',            (SELECT revenue   FROM base),
    'bookings',           (SELECT bookings  FROM base),
    'completed',          (SELECT completed FROM base),
    'cancelled',          (SELECT cancelled FROM base),
    'no_show',            (SELECT no_show   FROM base),
    'deposits_collected', (SELECT deposits  FROM base),
    'no_show_rate',       (SELECT round(no_show::numeric  / NULLIF(completed + no_show, 0), 3) FROM base),
    'cancellation_rate',  (SELECT round(cancelled::numeric / NULLIF(total_all, 0), 3) FROM base),
    'repeat_rate',        round((SELECT count(*) FILTER (WHERE n >= 2) FROM repeat_c)::numeric
                                / NULLIF((SELECT count(*) FROM repeat_c), 0), 3),
    'revenue_by_staff',   COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue)) FROM staff_rev), '[]'::jsonb),
    'by_weekday',         (SELECT jsonb_agg(COALESCE((SELECT c FROM weekday WHERE d = g), 0) ORDER BY g) FROM generate_series(1, 7) g),
    'by_hour',            (SELECT jsonb_agg(COALESCE((SELECT c FROM hour WHERE h = g), 0) ORDER BY g) FROM generate_series(0, 23) g)
  ) INTO v;

  RETURN v;
END;
$$;

COMMENT ON FUNCTION get_org_analytics IS
  'Pre-aggregated owner analytics for a date range (business time): revenue + '
  'revenue-by-staff, booking/completion/no-show/cancel/repeat rates, weekday & '
  'hour histograms, deposit collection. Members/superadmin only.';

-- 2. Stop the dispatch cron before dropping the function it calls.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-waitlist-offers') THEN
    PERFORM cron.unschedule('dispatch-waitlist-offers');
  END IF;
END $$;

-- 3. Drop the waitlist functions (unique names → drop by name).
DROP FUNCTION IF EXISTS dispatch_waitlist_offers;
DROP FUNCTION IF EXISTS claim_waitlist_offer;
DROP FUNCTION IF EXISTS get_waitlist_offer;
DROP FUNCTION IF EXISTS join_waitlist;

-- 4. Drop the freed-slot feeder (trigger + function). Manage cancel/reschedule
--    keeps working — it only UPDATEs the appointment; this trigger was the
--    waitlist's event source.
DROP TRIGGER IF EXISTS trg_record_slot_freed ON appointments;
DROP FUNCTION IF EXISTS record_slot_freed;

-- 5. Drop the tables (offers → entries → freed events).
DROP TABLE IF EXISTS waitlist_offers CASCADE;
DROP TABLE IF EXISTS waitlist_entries CASCADE;
DROP TABLE IF EXISTS slot_freed_events CASCADE;

-- 6. Drop the now-meaningless 'waitlist' feature flag from both tiers.
UPDATE platform_config
   SET tier_features = (tier_features #- '{solo,waitlist}') #- '{team,waitlist}'
 WHERE id = 1;
