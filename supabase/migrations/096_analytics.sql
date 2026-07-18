-- ============================================================
-- 096_analytics.sql
-- Run AFTER 095_recurring_appointments.sql.
--
-- Phase 6 — owner analytics. One read-only, pre-aggregated RPC the dashboard
-- reads for a chosen date range (no raw PII leaves the boundary). All time
-- bucketing is in business time (Asia/Tbilisi = +04:00), matching the rest of
-- the domain. Members/superadmin only.
-- ============================================================

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
  ),
  wl AS (
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'converted') AS converted
      FROM waitlist_entries
     WHERE org_id = p_org_id AND created_at::date BETWEEN p_from AND p_to
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
    'by_hour',            (SELECT jsonb_agg(COALESCE((SELECT c FROM hour WHERE h = g), 0) ORDER BY g) FROM generate_series(0, 23) g),
    'waitlist_total',     (SELECT total FROM wl),
    'waitlist_conversion',(SELECT round(converted::numeric / NULLIF(total, 0), 3) FROM wl)
  ) INTO v;

  RETURN v;
END;
$$;

COMMENT ON FUNCTION get_org_analytics IS
  'Pre-aggregated owner analytics for a date range (business time): revenue + '
  'revenue-by-staff, booking/completion/no-show/cancel/repeat rates, weekday & '
  'hour histograms, deposit collection, waitlist conversion. Members/superadmin only.';

REVOKE ALL ON FUNCTION get_org_analytics(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_org_analytics(uuid, date, date) TO authenticated;
