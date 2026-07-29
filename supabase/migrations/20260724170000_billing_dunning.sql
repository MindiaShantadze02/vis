-- ============================================================
-- 20260724170000_billing_dunning.sql  (BILLING_PLAN T3.1 / T3.2)
--
-- Dunning: a failed usage charge moves the org active → past_due, retries on the
-- billing_config schedule, and suspends after grace_days (or once retries are
-- exhausted). Every transition writes a billing_events audit row. A cleared
-- charge (retry or a manual "pay now") that leaves nothing outstanding restores
-- the org to active.
--
-- The provider OUTCOME is separated from the attempt: settle_usage_charge(id,
-- success, ...) is the state machine (called by charge_billing_period on a mock
-- success, by the real charge-usage edge fn, and by tests to drive a failure).
-- ============================================================

-- ── Audit trail ────────────────────────────────────────────────────────────
CREATE TABLE billing_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  billing_period_id uuid REFERENCES billing_periods(id) ON DELETE SET NULL,
  event_type        text NOT NULL,   -- charged / charge_failed / past_due / retry_scheduled / suspended / recovered
  detail            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_events_org ON billing_events(org_id, created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_events_select ON billing_events FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
GRANT SELECT ON billing_events TO authenticated;

-- ── Dunning bookkeeping on the period ──────────────────────────────────────
ALTER TABLE billing_periods
  ADD COLUMN IF NOT EXISTS attempts        int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_error      text;

-- ── settle_usage_charge — the outcome state machine ────────────────────────
CREATE OR REPLACE FUNCTION settle_usage_charge(
  p_id uuid, p_success boolean, p_reference text DEFAULT NULL, p_error text DEFAULT NULL)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_amount numeric(10,2); v_status text; v_attempts int; v_first timestamptz;
  v_retry jsonb; v_grace int; v_bill text; v_days int;
BEGIN
  SELECT bp.org_id, bp.amount_due, bp.status, bp.attempts, bp.first_failed_at,
         pc.billing_config -> 'retry_schedule', (pc.billing_config ->> 'grace_days')::int
    INTO v_org, v_amount, v_status, v_attempts, v_first, v_retry, v_grace
    FROM billing_periods bp CROSS JOIN platform_config pc
   WHERE bp.id = p_id AND pc.id = 1 FOR UPDATE OF bp;
  IF v_org IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status NOT IN ('pending', 'failed') THEN RETURN 'not_applicable'; END IF;

  PERFORM set_config('app.internal_billing', '1', true);  -- allow billing_status writes

  IF p_success THEN
    UPDATE billing_periods
       SET status = 'charged', charged_at = now(), next_retry_at = NULL,
           charge_reference = coalesce(p_reference, 'mock_usage_' || gen_random_uuid()::text)
     WHERE id = p_id;
    INSERT INTO payment_log (org_id, purpose, amount, currency, provider, status, provider_reference)
    VALUES (v_org, 'usage', v_amount, 'GEL', 'mock', 'paid',
            coalesce(p_reference, 'mock_usage_' || gen_random_uuid()::text));
    INSERT INTO billing_events (org_id, billing_period_id, event_type, detail)
    VALUES (v_org, p_id, 'charged', '₾' || v_amount);

    -- Recovery: nothing left outstanding → back to active.
    SELECT billing_status INTO v_bill FROM organisations WHERE id = v_org;
    IF v_bill IN ('past_due', 'suspended')
       AND NOT EXISTS (SELECT 1 FROM billing_periods WHERE org_id = v_org AND status IN ('pending', 'failed')) THEN
      UPDATE organisations SET billing_status = 'active' WHERE id = v_org;
      INSERT INTO billing_events (org_id, event_type) VALUES (v_org, 'recovered');
    END IF;
    RETURN 'charged';
  END IF;

  -- Failure path.
  v_attempts := coalesce(v_attempts, 0) + 1;
  IF v_first IS NULL THEN v_first := now(); END IF;
  INSERT INTO billing_events (org_id, billing_period_id, event_type, detail)
  VALUES (v_org, p_id, 'charge_failed', format('attempt %s: %s', v_attempts, coalesce(p_error, 'declined')));

  SELECT billing_status INTO v_bill FROM organisations WHERE id = v_org;
  IF v_bill = 'active' THEN
    UPDATE organisations SET billing_status = 'past_due' WHERE id = v_org;
    INSERT INTO billing_events (org_id, billing_period_id, event_type) VALUES (v_org, p_id, 'past_due');
  END IF;

  -- Suspend once grace has elapsed or retries are exhausted; else schedule next.
  IF now() >= v_first + make_interval(days => coalesce(v_grace, 0))
     OR v_attempts > coalesce(jsonb_array_length(v_retry), 0) THEN
    UPDATE billing_periods SET status = 'failed', attempts = v_attempts, first_failed_at = v_first,
           last_error = p_error, next_retry_at = NULL WHERE id = p_id;
    UPDATE organisations SET billing_status = 'suspended' WHERE id = v_org;
    INSERT INTO billing_events (org_id, billing_period_id, event_type) VALUES (v_org, p_id, 'suspended');
    RETURN 'suspended';
  END IF;

  v_days := coalesce((v_retry ->> (v_attempts - 1))::int, 1);  -- retry_schedule is 0-indexed
  UPDATE billing_periods SET status = 'failed', attempts = v_attempts, first_failed_at = v_first,
         last_error = p_error, next_retry_at = now() + make_interval(days => v_days) WHERE id = p_id;
  INSERT INTO billing_events (org_id, billing_period_id, event_type, detail)
  VALUES (v_org, p_id, 'retry_scheduled', format('in %s day(s)', v_days));
  RETURN 'failed';
END;
$function$;
REVOKE ALL ON FUNCTION settle_usage_charge(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;

-- ── charge_billing_period — one attempt (mock settles success) ─────────────
CREATE OR REPLACE FUNCTION charge_billing_period(p_id uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_status text; v_notified timestamptz; v_next timestamptz;
  v_notice int; v_provider text; v_bill text;
BEGIN
  SELECT bp.org_id, bp.status, bp.notified_at, bp.next_retry_at,
         (pc.billing_config ->> 'notice_days')::int, o.billing_status
    INTO v_org, v_status, v_notified, v_next, v_notice, v_bill
    FROM billing_periods bp
    JOIN organisations o ON o.id = bp.org_id
    CROSS JOIN platform_config pc
   WHERE bp.id = p_id AND pc.id = 1 FOR UPDATE OF bp;
  IF v_org IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status NOT IN ('pending', 'failed') THEN RETURN 'not_chargeable'; END IF;
  IF v_bill = 'suspended' THEN RETURN 'suspended'; END IF;  -- recovery is via pay-now, not auto-retry
  IF v_status = 'pending' AND (v_notified IS NULL OR now() < v_notified + make_interval(days => coalesce(v_notice, 0))) THEN
    RETURN 'notice_period';
  END IF;
  IF v_status = 'failed' AND (v_next IS NULL OR now() < v_next) THEN
    RETURN 'retry_pending';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM org_payment_methods WHERE org_id = v_org AND is_default AND status = 'active') THEN
    RETURN 'no_card';
  END IF;
  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN RETURN 'provider_not_configured'; END IF;

  RETURN settle_usage_charge(p_id, true, 'mock_usage_' || gen_random_uuid()::text);
END;
$function$;
REVOKE ALL ON FUNCTION charge_billing_period(uuid) FROM PUBLIC, anon, authenticated;

-- run_usage_charges also retries due 'failed' periods (charge_billing_period gates).
CREATE OR REPLACE FUNCTION run_usage_charges()
  RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT id FROM billing_periods WHERE status IN ('pending', 'failed') LOOP
    IF charge_billing_period(r.id) = 'charged' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION run_usage_charges() FROM PUBLIC, anon, authenticated;

-- ── pay_org_outstanding — owner "pay now" to clear the balance + recover ───
-- Owner/superadmin. Mock settles the outstanding periods directly (which
-- recovers active); a real provider would route this through a create-payment
-- 'usage' checkout instead. Returns how many periods were settled.
CREATE OR REPLACE FUNCTION pay_org_outstanding(p_org_id uuid)
  RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE r record; v_n int := 0; v_provider text;
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN RAISE EXCEPTION 'provider_not_configured'; END IF;
  FOR r IN SELECT id FROM billing_periods WHERE org_id = p_org_id AND status IN ('pending', 'failed') ORDER BY period_start LOOP
    PERFORM settle_usage_charge(r.id, true, 'mock_paynow_' || gen_random_uuid()::text);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION pay_org_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pay_org_outstanding(uuid) TO authenticated;
