-- ============================================================
-- 20260729120000_no_card_dunning.sql  (BILLING_PLAN fix)
--
-- Close the "free forever with no card" gap: previously charge_billing_period
-- returned 'no_card' as a soft skip, so a business that never added a card was
-- never charged AND never suspended — a due balance just sat pending forever.
--
-- Now a charge that has come DUE (past its notice/retry window) with no card on
-- file is treated as an uncollectable failure and routed into dunning: the org
-- goes past_due (prompting "add a card"), retries on schedule, and suspends
-- after grace_days — the same path as a declined charge. Adding a card + the
-- next retry (or pay-now) recovers it. A charge that isn't due yet is still
-- gated earlier (notice_period / retry_pending), so this only bites when money
-- is actually owed.
-- ============================================================
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
    FROM billing_periods bp JOIN organisations o ON o.id = bp.org_id
    CROSS JOIN platform_config pc WHERE bp.id = p_id AND pc.id = 1 FOR UPDATE OF bp;
  IF v_org IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status NOT IN ('pending','failed') THEN RETURN 'not_chargeable'; END IF;
  IF v_bill = 'suspended' THEN RETURN 'suspended'; END IF;
  IF v_status = 'pending' AND (v_notified IS NULL OR now() < v_notified + make_interval(days => coalesce(v_notice,0))) THEN
    RETURN 'notice_period';
  END IF;
  IF v_status = 'failed' AND (v_next IS NULL OR now() < v_next) THEN RETURN 'retry_pending'; END IF;

  -- Due, but no card → uncollectable → dunning (not a silent skip).
  IF NOT EXISTS (SELECT 1 FROM org_payment_methods WHERE org_id = v_org AND is_default AND status = 'active') THEN
    RETURN settle_usage_charge(p_id, false, NULL, 'no_card_on_file');
  END IF;

  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN RETURN 'provider_not_configured'; END IF;
  RETURN settle_usage_charge(p_id, true, 'mock_usage_' || gen_random_uuid()::text);
END;
$function$;
REVOKE ALL ON FUNCTION charge_billing_period(uuid) FROM PUBLIC, anon, authenticated;
