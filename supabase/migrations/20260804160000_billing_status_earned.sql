-- ============================================================
-- 20260804160000_billing_status_earned.sql
--
-- Surface the business's gross revenue for the current billing period next to
-- the Vis commission. `earned` sums the service price over the SAME billable set
-- the commission is charged on (approved/completed/no_show, by occurrence date
-- in the period), so the two figures are directly comparable on the dashboard.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_org_billing_status(p_org_id uuid)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_result jsonb; v_period_start timestamptz; v_price numeric(10,2);
  v_count int; v_earned numeric(10,2); v_rolled numeric(10,2);
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT current_period_start(o.usage_anchor), (pc.billing_config ->> 'appointment_price')::numeric
    INTO v_period_start, v_price
    FROM organisations o CROSS JOIN platform_config pc WHERE o.id = p_org_id AND pc.id = 1;
  SELECT count(*)::int, coalesce(round(sum(s.price), 2), 0)
    INTO v_count, v_earned
    FROM appointments a JOIN services s ON s.id = a.service_id
   WHERE a.org_id = p_org_id
     AND a.status IN ('approved','completed','no_show')
     AND a.scheduled_at >= v_period_start AND a.scheduled_at < v_period_start + interval '1 month';
  SELECT coalesce((SELECT amount_rolled_forward FROM billing_periods
                    WHERE org_id = p_org_id AND status <> 'open' ORDER BY period_start DESC LIMIT 1), 0)
    INTO v_rolled;
  SELECT jsonb_build_object(
           'billing_status', o.billing_status,
           'period_start', v_period_start, 'period_end', v_period_start + interval '1 month',
           'appointment_count', v_count, 'appointment_price', v_price,
           'running_amount', round(v_count * v_price, 2), 'earned', v_earned, 'rolled_forward', v_rolled,
           'card', (SELECT jsonb_build_object('last4', pm.last4, 'brand', pm.brand, 'expires_at', pm.expires_at)
                      FROM org_payment_methods pm
                     WHERE pm.org_id = o.id AND pm.is_default AND pm.status = 'active' LIMIT 1))
    INTO v_result FROM organisations o WHERE o.id = p_org_id;
  RETURN v_result;
END; $function$;
