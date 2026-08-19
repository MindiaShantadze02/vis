-- ============================================================
-- 20260826120000_superadmin_billing_ops_health.sql
--
-- Superadmin observability. Two RPCs, kept apart because they answer different
-- questions:
--   platform_billing_health  — is revenue landing?
--   platform_ops_health      — is the machinery still running?
--
-- The second exists because of the 2026-08-17 regression found in this sweep: a
-- billing control stopped working and NOTHING failed. The same risk applies to
-- the scheduled jobs — if billing-close quietly stops, nobody finds out until
-- month end, when no invoices exist.
--
-- Both are superadmin-only. They expose whole-platform financials and every
-- org's balance, so the guard is the entire access control; there is no RLS
-- behind them.
--
-- NOTE: the bodies here are copied from the live database (pg_get_functiondef),
-- not hand-rewritten. See the header of 20260824120000 for why that matters.
-- ============================================================

-- Definitions used by platform_billing_health:
--   outstanding          what is owed right now (pending + failed)
--   collection_by_month  charged / failed / pending / waived, PLUS 'uncollectable'
--                        (due, but the org has no card) counted SEPARATELY.
--                        Deliberate: the 2026-08-17 regression made the charge run
--                        skip no-card orgs silently, and a naive
--                        charged/(charged+failed) ratio would have read a healthy
--                        100% the whole time it was losing money. A rate that
--                        cannot see its own denominator shrinking is worse than
--                        no rate at all.
--   no_card              businesses we cannot charge — a worklist, not a metric
--   expiring_cards       the cheapest save available: a card expiring silently
--                        becomes a dunning cycle that never needed to happen
--   dunning              recovered vs suspended + median days-to-recover; the
--                        only way to tell whether the grace window and retry
--                        schedule set in 20260825120000 are tuned right
--   revenue_by_month     billable occurrences x appointment_price
CREATE OR REPLACE FUNCTION public.platform_billing_health(p_months int DEFAULT 6)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_from  timestamptz := now() - make_interval(months => greatest(coalesce(p_months, 6), 1));
  v_price numeric;
  v_out   jsonb;
BEGIN
  IF NOT coalesce(is_superadmin(), false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT (billing_config ->> 'appointment_price')::numeric INTO v_price
    FROM platform_config WHERE id = 1;

  SELECT jsonb_build_object(
    'months', greatest(coalesce(p_months, 6), 1),
    'appointment_price', v_price,
    'outstanding', (
      SELECT jsonb_build_object(
               'amount', coalesce(sum(amount_due), 0),
               'periods', count(*),
               'orgs', count(DISTINCT org_id),
               'oldest_due', min(period_end)
             )
        FROM billing_periods WHERE status IN ('pending','failed')
    ),
    'collection_by_month', coalesce((
      SELECT jsonb_agg(m ORDER BY m.month)
        FROM (
          SELECT to_char(date_trunc('month', bp.period_end), 'YYYY-MM') AS month,
                 count(*) FILTER (WHERE bp.status = 'charged')::int      AS charged,
                 count(*) FILTER (WHERE bp.status = 'failed')::int       AS failed,
                 count(*) FILTER (WHERE bp.status = 'pending')::int      AS pending,
                 count(*) FILTER (WHERE bp.status = 'waived')::int       AS waived,
                 count(*) FILTER (
                   WHERE bp.status IN ('pending','failed')
                     AND NOT EXISTS (SELECT 1 FROM org_payment_methods pm
                                      WHERE pm.org_id = bp.org_id AND pm.is_default AND pm.status = 'active')
                 )::int                                                  AS uncollectable,
                 coalesce(sum(bp.amount_due) FILTER (WHERE bp.status = 'charged'), 0) AS collected
            FROM billing_periods bp
           WHERE bp.period_end >= v_from::date
           GROUP BY 1
        ) m
    ), '[]'::jsonb),
    'no_card', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'org_id', o.id, 'name', o.name, 'slug', o.slug,
               'billing_status', o.billing_status,
               'owed', coalesce((SELECT sum(amount_due) FROM billing_periods bp
                                  WHERE bp.org_id = o.id AND bp.status IN ('pending','failed')), 0))
             ORDER BY o.name)
        FROM organisations o
       WHERE NOT coalesce(o.billing_exempt, false)
         AND NOT EXISTS (SELECT 1 FROM org_payment_methods pm
                          WHERE pm.org_id = o.id AND pm.is_default AND pm.status = 'active')
    ), '[]'::jsonb),
    'expiring_cards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'org_id', o.id, 'name', o.name, 'last4', pm.last4, 'expires_at', pm.expires_at)
             ORDER BY pm.expires_at)
        FROM org_payment_methods pm JOIN organisations o ON o.id = pm.org_id
       WHERE pm.is_default AND pm.status = 'active'
         AND pm.expires_at IS NOT NULL
         AND pm.expires_at <= (now() + interval '30 days')::date
    ), '[]'::jsonb),
    'dunning', (
      SELECT jsonb_build_object(
               'past_due',  count(*) FILTER (WHERE event_type = 'past_due'),
               'suspended', count(*) FILTER (WHERE event_type = 'suspended'),
               'recovered', count(*) FILTER (WHERE event_type = 'recovered'),
               'median_days_to_recover', (
                 SELECT round(percentile_cont(0.5) WITHIN GROUP (
                          ORDER BY extract(epoch FROM (r.created_at - p.created_at)) / 86400.0)::numeric, 1)
                   FROM billing_events p
                   JOIN LATERAL (
                     SELECT created_at FROM billing_events r
                      WHERE r.org_id = p.org_id AND r.event_type = 'recovered'
                        AND r.created_at > p.created_at
                      ORDER BY r.created_at LIMIT 1
                   ) r ON true
                  WHERE p.event_type = 'past_due' AND p.created_at >= v_from
               )
             )
        FROM billing_events WHERE created_at >= v_from
    ),
    'revenue_by_month', coalesce((
      SELECT jsonb_agg(m ORDER BY m.month)
        FROM (
          SELECT to_char(date_trunc('month', coalesce(a.billable_period_at, a.scheduled_at)), 'YYYY-MM') AS month,
                 count(*)::int AS billable,
                 round(count(*) * coalesce(v_price, 0), 2) AS revenue
            FROM appointments a
           WHERE coalesce(a.billable_period_at, a.scheduled_at) >= v_from
             AND coalesce(a.billable_period_at, a.scheduled_at) < now()
             AND (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM organisations o
                              WHERE o.id = a.org_id AND coalesce(o.billing_exempt, false))
           GROUP BY 1
        ) m
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_billing_health(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_billing_health(int) TO authenticated;

-- `stale` compares the last SUCCESSFUL run against the job's own cadence, so a
-- job that stops is visible the next day rather than the next billing cycle.
--
-- otp_7d.failure_pct uses verified + failed as the denominator, NOT `attempts > 0`
-- — mark_booking_otp_verified refunds the attempt on success, so a verified
-- challenge ends at attempts = 0. Using attempts reported a 66% failure rate
-- against a real 9.8%.
CREATE OR REPLACE FUNCTION public.platform_ops_health()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT coalesce(is_superadmin(), false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'cron', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'job', j.jobname,
               'schedule', j.schedule,
               'active', j.active,
               'last_run', r.last_run,
               'last_success', r.last_success,
               'failures_24h', coalesce(r.failures_24h, 0),
               'stale', (
                 r.last_success IS NULL
                 OR r.last_success < now() - CASE
                      WHEN j.schedule LIKE '*/%' THEN interval '1 hour'
                      ELSE interval '26 hours'
                    END
               )
             ) ORDER BY j.jobname)
        FROM cron.job j
        LEFT JOIN LATERAL (
          SELECT max(d.start_time)                                          AS last_run,
                 max(d.start_time) FILTER (WHERE d.status = 'succeeded')    AS last_success,
                 count(*) FILTER (WHERE d.status <> 'succeeded'
                                    AND d.start_time > now() - interval '24 hours')::int AS failures_24h
            FROM cron.job_run_details d WHERE d.jobid = j.jobid
        ) r ON true
    ), '[]'::jsonb),
    'otp_7d', (
      SELECT jsonb_build_object(
               'issued',      count(*),
               'verified',    count(*) FILTER (WHERE verified_at IS NOT NULL),
               'failed',      count(*) FILTER (WHERE verified_at IS NULL AND attempts > 0),
               'never_tried', count(*) FILTER (WHERE verified_at IS NULL AND attempts = 0),
               'hit_the_cap', count(*) FILTER (WHERE attempts > 5),
               'failure_pct', CASE
                 WHEN (count(*) FILTER (WHERE verified_at IS NOT NULL)
                     + count(*) FILTER (WHERE verified_at IS NULL AND attempts > 0)) > 0
                 THEN round(100.0 * count(*) FILTER (WHERE verified_at IS NULL AND attempts > 0)
                            / (count(*) FILTER (WHERE verified_at IS NOT NULL)
                             + count(*) FILTER (WHERE verified_at IS NULL AND attempts > 0)), 1)
                 ELSE 0 END
             )
        FROM booking_verifications WHERE created_at > now() - interval '7 days'
    )
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_ops_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ops_health() TO authenticated;
