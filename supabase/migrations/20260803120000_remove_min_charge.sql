-- ============================================================
-- 20260803120000_remove_min_charge.sql  (BILLING_PLAN change)
--
-- Remove the "free tier": drop the minimum-charge floor so every billable
-- appointment is charged at the ₾1 commission from the first one — no more
-- rolling small balances forward tax-free. appointment_price stays ₾1.
--
-- minimum_charge → 0. The close job now waives ONLY a genuinely zero month
-- (no appointments) so it never creates a pointless ₾0 charge/notice; any
-- positive amount is 'pending' and billed. (The <minimum rollover branch is
-- kept intact for any future non-zero minimum — it's simply dead while min=0.)
-- ============================================================
UPDATE platform_config
   SET billing_config = jsonb_set(billing_config, '{minimum_charge}', '0'::jsonb)
 WHERE id = 1;
-- Keep the column DEFAULT coherent for any future reseed.
ALTER TABLE platform_config
  ALTER COLUMN billing_config SET DEFAULT '{
    "appointment_price": 1,
    "minimum_charge": 0,
    "notice_days": 3,
    "grace_days": 7,
    "retry_schedule": [1, 3, 7]
  }'::jsonb;

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

  IF v_amount <= 0 THEN
    -- Nothing owed (zero-appointment month) → waived, never a ₾0 charge.
    v_status := 'waived'; v_rolled_out := 0; v_amount := 0; v_notified := NULL;
  ELSIF v_amount < v_min THEN
    -- Below a (currently 0) floor → carry forward. Dead while minimum_charge = 0.
    v_status := 'waived'; v_rolled_out := v_amount; v_amount := 0; v_notified := NULL;
  ELSE
    v_status := 'pending'; v_rolled_out := 0; v_notified := now();
  END IF;

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

  IF v_status = 'pending' AND v_owner IS NOT NULL THEN
    INSERT INTO notifications (org_id, user_id, type, title, body)
    VALUES (p_org_id, v_owner, 'billing_notice', 'მოახლოებული გადახდა',
            format('თქვენი %s-ის ინვოისი ₾%s ჩამოიჭრება %s დღეში.', to_char(v_s, 'Mon YYYY'), v_amount, v_notice));
  END IF;

  RETURN v_bp_id;
END;
$function$;
REVOKE ALL ON FUNCTION close_billing_period_for_org(uuid) FROM PUBLIC, anon, authenticated;
