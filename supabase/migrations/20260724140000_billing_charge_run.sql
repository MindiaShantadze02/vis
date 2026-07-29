-- ============================================================
-- 20260724140000_billing_charge_run.sql  (BILLING_PLAN T1.3b)
--
-- Charge run: settle each 'pending' billing_period against the org's card on
-- file. Post-paid usage charges are MERCHANT-INITIATED (the business isn't
-- present), so they don't use the customer-present checkout-redirect flow —
-- the mock provider settles synchronously here and records a payment_log row
-- with purpose 'usage' (the audit trail the plan asks for). A real
-- merchant-initiated token charge (BOG/TBC execute-recurring) runs in a
-- charge-usage edge function once creds exist; left stubbed, same mock-first
-- posture as create-payment. Idempotent: only a 'pending' period is charged,
-- and charging flips it to 'charged', so a re-run is a no-op.
-- ============================================================

CREATE OR REPLACE FUNCTION charge_billing_period(p_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org      uuid;
  v_amount   numeric(10,2);
  v_status   text;
  v_provider text;
  v_ref      text;
BEGIN
  SELECT org_id, amount_due, status INTO v_org, v_amount, v_status
    FROM billing_periods WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_status <> 'pending' THEN RETURN 'not_pending'; END IF;   -- idempotent

  -- A card on file is required; without one the period stays pending and the
  -- advance-notice / dunning path (T2.3 / T3) prompts the owner.
  IF NOT EXISTS (SELECT 1 FROM org_payment_methods
                  WHERE org_id = v_org AND is_default AND status = 'active') THEN
    RETURN 'no_card';
  END IF;

  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN
    -- Real merchant-initiated token charge is done by the charge-usage edge
    -- function (provider seam); not wired until BOG/TBC credentials exist.
    RETURN 'provider_not_configured';
  END IF;

  -- Mock provider: nobody is actually charged — settle immediately.
  v_ref := 'mock_usage_' || gen_random_uuid()::text;
  UPDATE billing_periods
     SET status = 'charged', charged_at = now(), charge_reference = v_ref
   WHERE id = p_id;
  INSERT INTO payment_log (org_id, purpose, amount, currency, provider, status, provider_reference)
  VALUES (v_org, 'usage', v_amount, 'GEL', 'mock', 'paid', v_ref);
  RETURN 'charged';
END;
$function$;
REVOKE ALL ON FUNCTION charge_billing_period(uuid) FROM PUBLIC, anon, authenticated;

-- Cron entry point: charge every pending period. Returns how many were charged.
CREATE OR REPLACE FUNCTION run_usage_charges()
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT id FROM billing_periods WHERE status = 'pending' LOOP
    IF charge_billing_period(r.id) = 'charged' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION run_usage_charges() FROM PUBLIC, anon, authenticated;

-- Run the charge sweep daily at 03:30 UTC, 30 min after the close job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-charge') THEN
    PERFORM cron.unschedule('billing-charge');
  END IF;
  PERFORM cron.schedule('billing-charge', '30 3 * * *', $cron$ SELECT run_usage_charges(); $cron$);
END;
$$;
