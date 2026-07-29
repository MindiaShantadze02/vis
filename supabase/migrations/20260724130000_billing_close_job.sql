-- ============================================================
-- 20260724130000_billing_close_job.sql  (BILLING_PLAN T1.3a)
--
-- Period close: at each month boundary, count an org's billable appointments
-- BY OCCURRENCE DATE (D3), write the immutable line-item ledger, fold in any
-- rolled-forward balance, and decide the period's fate:
--   amount == 0            → 'waived' (nothing owed)
--   0 < amount < minimum   → 'waived', carry the amount forward (below the floor)
--   amount >= minimum      → 'pending' (a charge is due; T1.3b executes it)
--
-- The billing period IS the usage period: derived from current_period_start(
-- usage_anchor), so counting and billing share one clock. Idempotent — the
-- UNIQUE(org_id, period_start) row is created exactly once per period, and the
-- line items are UNIQUE per appointment, so a re-run never double-counts or
-- double-charges.
-- ============================================================

-- ── close_billing_period_for_org — closes the EARLIEST ended-but-unclosed
--    period for one org (sequential, so rollover chains correctly), or NULL if
--    none is due. Returns the closed billing_periods id. Service/cron only.
CREATE OR REPLACE FUNCTION close_billing_period_for_org(p_org_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor      timestamptz;
  v_price       numeric(10,2);
  v_min         numeric(10,2);
  v_s           timestamptz;             -- candidate period start
  v_end         timestamptz;
  v_incoming    numeric(10,2) := 0;      -- rollover carried in from the prior period
  v_count       int;
  v_amount      numeric(10,2);
  v_status      text;
  v_rolled_out  numeric(10,2) := 0;
  v_bp_id       uuid;
BEGIN
  SELECT o.usage_anchor,
         (pc.billing_config ->> 'appointment_price')::numeric,
         (pc.billing_config ->> 'minimum_charge')::numeric
    INTO v_anchor, v_price, v_min
    FROM organisations o CROSS JOIN platform_config pc
   WHERE o.id = p_org_id AND pc.id = 1;
  IF v_anchor IS NULL THEN RETURN NULL; END IF;

  -- Walk monthly from the anchor to the first period that has ENDED and has no
  -- billing_periods row yet.
  v_s := v_anchor;
  LOOP
    v_end := v_s + interval '1 month';
    EXIT WHEN v_end > now();  -- this period is still in progress → stop
    IF NOT EXISTS (SELECT 1 FROM billing_periods
                    WHERE org_id = p_org_id AND period_start = v_s::date) THEN
      EXIT;  -- v_s is the earliest ended-but-unclosed period
    END IF;
    v_s := v_end;
  END LOOP;
  IF v_end > now() THEN RETURN NULL; END IF;  -- nothing due

  -- Carry-in from the immediately preceding period (0 for the first period).
  SELECT coalesce(amount_rolled_forward, 0) INTO v_incoming
    FROM billing_periods
   WHERE org_id = p_org_id AND period_start = (v_s - interval '1 month')::date;
  v_incoming := coalesce(v_incoming, 0);

  -- Billable this period: occurrence in [v_s, v_end) AND a billable final status.
  SELECT count(*)::int INTO v_count
    FROM appointments a
   WHERE a.org_id = p_org_id
     AND a.status IN ('approved', 'completed', 'no_show', 'deposit_paid')
     AND a.scheduled_at >= v_s AND a.scheduled_at < v_end;

  v_amount := round(v_count * v_price + v_incoming, 2);

  -- Below the floor (incl. zero) → waive + carry forward; else charge is due.
  IF v_amount < v_min THEN
    v_status := 'waived';
    v_rolled_out := v_amount;
    v_amount := 0;
  ELSE
    v_status := 'pending';
    v_rolled_out := 0;
  END IF;

  -- Idempotent: a concurrent run inserting the same (org, period_start) loses.
  INSERT INTO billing_periods (org_id, period_start, period_end, appointment_count,
                               amount_due, amount_rolled_forward, status)
  VALUES (p_org_id, v_s::date, v_end::date, v_count, v_amount, v_rolled_out, v_status)
  ON CONFLICT (org_id, period_start) DO NOTHING
  RETURNING id INTO v_bp_id;
  IF v_bp_id IS NULL THEN RETURN NULL; END IF;

  -- Immutable ledger: one line per billable appointment (UNIQUE appointment_id
  -- keeps it idempotent). Waived periods still record which appointments were
  -- counted — the carried lari trace here.
  INSERT INTO billing_line_items (billing_period_id, appointment_id, amount)
  SELECT v_bp_id, a.id, v_price
    FROM appointments a
   WHERE a.org_id = p_org_id
     AND a.status IN ('approved', 'completed', 'no_show', 'deposit_paid')
     AND a.scheduled_at >= v_s AND a.scheduled_at < v_end
  ON CONFLICT (appointment_id) DO NOTHING;

  RETURN v_bp_id;
END;
$function$;
REVOKE ALL ON FUNCTION close_billing_period_for_org(uuid) FROM PUBLIC, anon, authenticated;

-- ── run_billing_close — cron entry point. Closes every org's backlog of ended
--    periods (loops per org so a missed month is caught up in order). Returns
--    how many periods were closed.
CREATE OR REPLACE FUNCTION run_billing_close()
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; v_closed int := 0; v_id uuid;
BEGIN
  FOR r IN SELECT id FROM organisations LOOP
    LOOP
      v_id := close_billing_period_for_org(r.id);
      EXIT WHEN v_id IS NULL;
      v_closed := v_closed + 1;
    END LOOP;
  END LOOP;
  RETURN v_closed;
END;
$function$;
REVOKE ALL ON FUNCTION run_billing_close() FROM PUBLIC, anon, authenticated;

-- ── Schedule it daily at 03:00 UTC (idempotent per period, so a daily run just
--    closes each period shortly after it ends). (Re)schedule idempotently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-close') THEN
    PERFORM cron.unschedule('billing-close');
  END IF;
  PERFORM cron.schedule('billing-close', '0 3 * * *', $cron$ SELECT run_billing_close(); $cron$);
END;
$$;
