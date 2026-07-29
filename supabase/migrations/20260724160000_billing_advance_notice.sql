-- ============================================================
-- 20260724160000_billing_advance_notice.sql  (BILLING_PLAN T2.3)
--
-- Advance notice before charging: when a period closes owing money it is not
-- charged immediately — an in-app notice goes to the owner and the charge waits
-- notice_days (billing_config). Card schemes expect advance notice for variable
-- recurring amounts, and it heads off "what is this charge" disputes.
--
--   * close_billing_period_for_org: a 'pending' period stamps notified_at and
--     inserts exactly one in-app notification (idempotent — the period row is
--     created once).
--   * charge_billing_period: only charges once now() >= notified_at + notice_days.
--
-- (SMS delivery reuses the event-driven send-sms seam, which is appointment-
-- centric today; the in-app notice is wired here and the SMS branch is a
-- follow-on. Stored notice text is Georgian, matching the app's other
-- DB-authored notifications.)
-- ============================================================

ALTER TABLE billing_periods ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Allow the in-app billing notice type.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['new_appointment','pending_approval','appointment_cancelled','new_reservation','new_stay','billing_notice']));

-- Recreate the close job: stamp notified_at + notify on a pending close.
CREATE OR REPLACE FUNCTION close_billing_period_for_org(p_org_id uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_anchor timestamptz; v_price numeric(10,2); v_min numeric(10,2); v_notice int;
  v_s timestamptz; v_end timestamptz; v_incoming numeric(10,2) := 0;
  v_count int; v_amount numeric(10,2); v_status text; v_rolled_out numeric(10,2) := 0;
  v_notified timestamptz; v_bp_id uuid; v_owner uuid;
BEGIN
  SELECT o.usage_anchor, o.owner_id,
         (pc.billing_config ->> 'appointment_price')::numeric,
         (pc.billing_config ->> 'minimum_charge')::numeric,
         (pc.billing_config ->> 'notice_days')::int
    INTO v_anchor, v_owner, v_price, v_min, v_notice
    FROM organisations o CROSS JOIN platform_config pc WHERE o.id = p_org_id AND pc.id = 1;
  IF v_anchor IS NULL THEN RETURN NULL; END IF;

  v_s := v_anchor;
  LOOP
    v_end := v_s + interval '1 month';
    EXIT WHEN v_end > now();
    IF NOT EXISTS (SELECT 1 FROM billing_periods WHERE org_id = p_org_id AND period_start = v_s::date) THEN EXIT; END IF;
    v_s := v_end;
  END LOOP;
  IF v_end > now() THEN RETURN NULL; END IF;

  SELECT coalesce(amount_rolled_forward, 0) INTO v_incoming
    FROM billing_periods WHERE org_id = p_org_id AND period_start = (v_s - interval '1 month')::date;
  v_incoming := coalesce(v_incoming, 0);

  SELECT count(*)::int INTO v_count FROM appointments a
   WHERE a.org_id = p_org_id AND a.status IN ('approved','completed','no_show','deposit_paid')
     AND a.scheduled_at >= v_s AND a.scheduled_at < v_end;

  v_amount := round(v_count * v_price + v_incoming, 2);
  IF v_amount < v_min THEN v_status := 'waived'; v_rolled_out := v_amount; v_amount := 0; v_notified := NULL;
  ELSE v_status := 'pending'; v_rolled_out := 0; v_notified := now(); END IF;

  INSERT INTO billing_periods (org_id, period_start, period_end, appointment_count, amount_due, amount_rolled_forward, status, notified_at)
  VALUES (p_org_id, v_s::date, v_end::date, v_count, v_amount, v_rolled_out, v_status, v_notified)
  ON CONFLICT (org_id, period_start) DO NOTHING
  RETURNING id INTO v_bp_id;
  IF v_bp_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO billing_line_items (billing_period_id, appointment_id, amount)
  SELECT v_bp_id, a.id, v_price FROM appointments a
   WHERE a.org_id = p_org_id AND a.status IN ('approved','completed','no_show','deposit_paid')
     AND a.scheduled_at >= v_s AND a.scheduled_at < v_end
  ON CONFLICT (appointment_id) DO NOTHING;

  -- Advance notice for a charge that's now due (once, at close).
  IF v_status = 'pending' AND v_owner IS NOT NULL THEN
    INSERT INTO notifications (org_id, user_id, type, title, body)
    VALUES (p_org_id, v_owner, 'billing_notice', 'მოახლოებული გადახდა',
            format('თქვენი %s-ის ინვოისი ₾%s ჩამოიჭრება %s დღეში.', to_char(v_s, 'Mon YYYY'), v_amount, v_notice));
  END IF;

  RETURN v_bp_id;
END;
$function$;
REVOKE ALL ON FUNCTION close_billing_period_for_org(uuid) FROM PUBLIC, anon, authenticated;

-- Recreate the charge: hold until notice_days after the notice.
CREATE OR REPLACE FUNCTION charge_billing_period(p_id uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_amount numeric(10,2); v_status text; v_notified timestamptz;
  v_notice int; v_provider text; v_ref text;
BEGIN
  SELECT bp.org_id, bp.amount_due, bp.status, bp.notified_at,
         (pc.billing_config ->> 'notice_days')::int
    INTO v_org, v_amount, v_status, v_notified, v_notice
    FROM billing_periods bp CROSS JOIN platform_config pc
   WHERE bp.id = p_id AND pc.id = 1
   FOR UPDATE OF bp;
  IF v_org IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status <> 'pending' THEN RETURN 'not_pending'; END IF;

  -- Advance-notice hold: don't charge before notice_days have elapsed.
  IF v_notified IS NULL OR now() < v_notified + make_interval(days => coalesce(v_notice, 0)) THEN
    RETURN 'notice_period';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM org_payment_methods WHERE org_id = v_org AND is_default AND status = 'active') THEN
    RETURN 'no_card';
  END IF;

  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN RETURN 'provider_not_configured'; END IF;

  v_ref := 'mock_usage_' || gen_random_uuid()::text;
  UPDATE billing_periods SET status = 'charged', charged_at = now(), charge_reference = v_ref WHERE id = p_id;
  INSERT INTO payment_log (org_id, purpose, amount, currency, provider, status, provider_reference)
  VALUES (v_org, 'usage', v_amount, 'GEL', 'mock', 'paid', v_ref);
  RETURN 'charged';
END;
$function$;
REVOKE ALL ON FUNCTION charge_billing_period(uuid) FROM PUBLIC, anon, authenticated;
