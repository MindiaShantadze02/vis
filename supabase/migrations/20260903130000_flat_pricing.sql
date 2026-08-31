-- ============================================================
-- 20260903130000_flat_pricing.sql
--
-- Pricing moves from "₾1 per appointment" to "₾15 a month, plus ₾0.7 per
-- appointment for orgs that bought the SMS add-on".
--
--   base_monthly_fee      15    charged every period, including empty ones
--   sms_appointment_price 0.7   per appointment with sms_billable = true
--
-- The first period an org ever closes is free of the base fee — a business
-- should not pay a subscription for the month it was still setting up. SMS
-- charges still apply in that first period: those are messages actually sent.
--
-- ⚠️ close_billing_period_for_org is rebuilt below from the 20260824120000 body
-- PLUS the appointment-predicate change that migration's comment (lines 319-323)
-- records as having been applied to the cloud only, as
-- billing_pin_period_and_owner_only_card:
--     AND coalesce(a.billable_period_at, a.scheduled_at) >= v_s
--     AND coalesce(a.billable_period_at, a.scheduled_at) <  v_end
-- Before pushing this, diff it against pg_get_functiondef on the live database.
-- Re-declaring this function from a stale repo copy is exactly what produced the
-- 2026-08-17 "no card = free forever" regression.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The price list.
--
--    appointment_price is retired. It is left out of the new default rather
--    than kept at 0, so anything still reading it fails loudly instead of
--    silently invoicing nothing.
-- ------------------------------------------------------------
ALTER TABLE public.platform_config
  ALTER COLUMN billing_config SET DEFAULT '{
    "base_monthly_fee": 15,
    "sms_appointment_price": 0.7,
    "minimum_charge": 0,
    "notice_days": 3,
    "grace_days": 7,
    "retry_schedule": [1, 3, 7],
    "retro_cancel_grace_hours": 24
  }'::jsonb;

UPDATE public.platform_config
   SET billing_config = (billing_config - 'appointment_price')
                        || jsonb_build_object('base_monthly_fee', 15,
                                              'sms_appointment_price', 0.7)
 WHERE id = 1;

-- ------------------------------------------------------------
-- 2. billing_line_items gains a kind.
--
--    The old UNIQUE (appointment_id) cannot express the new invoice: a base fee
--    has no appointment at all, so a second NULL-appointment row per period had
--    to be possible while still charging each appointment exactly once.
--
--    Two partial unique indexes replace it, and between them they keep the
--    protection the old constraint gave:
--      * one base row per period;
--      * one row per (appointment, kind) ACROSS periods — so an appointment
--        that moves between months still cannot be billed twice.
--
--    Existing rows keep kind = 'appointment': they are historical ₾1-per-
--    appointment charges under the retired model, and relabelling them would
--    misstate what was invoiced.
-- ------------------------------------------------------------
ALTER TABLE public.billing_line_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'appointment';

ALTER TABLE public.billing_line_items
  DROP CONSTRAINT IF EXISTS billing_line_items_kind_check;
ALTER TABLE public.billing_line_items
  ADD CONSTRAINT billing_line_items_kind_check
  CHECK (kind IN ('appointment', 'base', 'sms'));

ALTER TABLE public.billing_line_items
  DROP CONSTRAINT IF EXISTS billing_line_items_appointment_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS billing_line_items_appointment_kind_uniq
  ON public.billing_line_items (appointment_id, kind)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_line_items_period_kind_uniq
  ON public.billing_line_items (billing_period_id, kind)
  WHERE appointment_id IS NULL;

COMMENT ON COLUMN public.billing_line_items.kind IS
  '''base'' = the flat monthly fee (appointment_id NULL, one per period); ''sms'' '
  '= the per-appointment SMS add-on fee; ''appointment'' = the retired ₾1-per-'
  'appointment charge, kept on historical rows.';

-- ------------------------------------------------------------
-- 3. close_billing_period_for_org — the invoice.
--
--    amount = base + sms_count × sms_price + rolled_forward
--
--    base is 0 for the org's very first period (v_s is still the usage_anchor
--    at that point, because the loop starts there and only advances past
--    periods that already closed).
--
--    sms_count counts appointments stamped sms_billable at insert time. Reading
--    the stamp rather than organisations.sms_enabled is what makes a closed
--    period immutable: turning the add-on off tomorrow cannot rewrite today's
--    invoice, which is why the toggle is safe to leave owner-writable.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_billing_period_for_org(p_org_id uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_anchor timestamptz; v_base numeric(10,2); v_sms_price numeric(10,2);
  v_min numeric(10,2); v_notice int;
  v_s timestamptz; v_end timestamptz; v_incoming numeric(10,2) := 0;
  v_count int; v_sms_count int; v_base_due numeric(10,2);
  v_amount numeric(10,2); v_status text; v_rolled_out numeric(10,2) := 0;
  v_notified timestamptz; v_bp_id uuid; v_owner uuid; v_exempt boolean;
BEGIN
  SELECT o.usage_anchor, o.owner_id, o.billing_exempt,
         (pc.billing_config ->> 'base_monthly_fee')::numeric,
         (pc.billing_config ->> 'sms_appointment_price')::numeric,
         (pc.billing_config ->> 'minimum_charge')::numeric,
         (pc.billing_config ->> 'notice_days')::int
    INTO v_anchor, v_owner, v_exempt, v_base, v_sms_price, v_min, v_notice
    FROM organisations o CROSS JOIN platform_config pc WHERE o.id = p_org_id AND pc.id = 1;
  IF v_anchor IS NULL THEN RETURN NULL; END IF;
  IF coalesce(v_exempt, false) THEN RETURN NULL; END IF;
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

  -- Total billable appointments (informational, stored on the period) and the
  -- subset that owes an SMS fee.
  SELECT count(*)::int,
         count(*) FILTER (WHERE a.sms_billable)::int
    INTO v_count, v_sms_count
    FROM appointments a
   WHERE a.org_id = p_org_id
     AND (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL)
     AND coalesce(a.billable_period_at, a.scheduled_at) >= v_s
     AND coalesce(a.billable_period_at, a.scheduled_at) <  v_end;

  -- First period an org ever closes: no subscription fee.
  v_base_due := CASE WHEN v_s = v_anchor THEN 0 ELSE coalesce(v_base, 0) END;

  v_amount := round(v_base_due + v_sms_count * coalesce(v_sms_price, 0) + v_incoming, 2);
  IF v_amount <= 0 THEN
    v_status := 'waived'; v_rolled_out := 0; v_amount := 0; v_notified := NULL;
  ELSIF v_amount < v_min THEN
    v_status := 'waived'; v_rolled_out := v_amount; v_amount := 0; v_notified := NULL;
  ELSE
    v_status := 'pending'; v_rolled_out := 0; v_notified := now();
  END IF;

  INSERT INTO billing_periods (org_id, period_start, period_end, appointment_count, amount_due, amount_rolled_forward, status, notified_at)
  VALUES (p_org_id, v_s::date, v_end::date, v_count, v_amount, v_rolled_out, v_status, v_notified)
  ON CONFLICT (org_id, period_start) DO NOTHING RETURNING id INTO v_bp_id;
  IF v_bp_id IS NULL THEN RETURN NULL; END IF;

  IF v_base_due > 0 THEN
    INSERT INTO billing_line_items (billing_period_id, appointment_id, amount, kind)
    VALUES (v_bp_id, NULL, v_base_due, 'base')
    ON CONFLICT (billing_period_id, kind) WHERE appointment_id IS NULL DO NOTHING;
  END IF;

  INSERT INTO billing_line_items (billing_period_id, appointment_id, amount, kind)
  SELECT v_bp_id, a.id, coalesce(v_sms_price, 0), 'sms' FROM appointments a
   WHERE a.org_id = p_org_id
     AND a.sms_billable
     AND (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL)
     AND coalesce(a.billable_period_at, a.scheduled_at) >= v_s
     AND coalesce(a.billable_period_at, a.scheduled_at) <  v_end
  ON CONFLICT (appointment_id, kind) WHERE appointment_id IS NOT NULL DO NOTHING;

  IF v_status = 'pending' AND v_owner IS NOT NULL THEN
    INSERT INTO notifications (org_id, user_id, type, title, body)
    VALUES (p_org_id, v_owner, 'billing_notice', 'მოახლოებული გადახდა',
            format('თქვენი %s-ის ინვოისი ₾%s ჩამოიჭრება %s დღეში.', to_char(v_s, 'Mon YYYY'), v_amount, v_notice));
  END IF;
  RETURN v_bp_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.close_billing_period_for_org(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.close_billing_period_for_org IS
  'Closes one elapsed billing period: flat base fee (waived for the org''s first '
  'period) + sms_appointment_price per sms_billable appointment + any rolled-'
  'forward balance. Counts the sms_billable stamp, never the live org flag.';

-- ------------------------------------------------------------
-- 4. get_org_billing_status — the live meter the owner sees.
--
--    Mirrors the close job's arithmetic so the running total and the eventual
--    invoice agree. It still reads scheduled_at rather than
--    coalesce(billable_period_at, scheduled_at) — a pre-existing divergence,
--    left alone here rather than widened.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_billing_status(p_org_id uuid)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_result jsonb; v_period_start timestamptz; v_anchor timestamptz;
  v_base numeric(10,2); v_sms_price numeric(10,2);
  v_count int; v_sms_count int; v_earned numeric(10,2); v_rolled numeric(10,2);
  v_base_due numeric(10,2);
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT o.usage_anchor,
         current_period_start(o.usage_anchor),
         (pc.billing_config ->> 'base_monthly_fee')::numeric,
         (pc.billing_config ->> 'sms_appointment_price')::numeric
    INTO v_anchor, v_period_start, v_base, v_sms_price
    FROM organisations o CROSS JOIN platform_config pc
   WHERE o.id = p_org_id AND pc.id = 1;

  SELECT count(*)::int,
         count(*) FILTER (WHERE a.sms_billable)::int,
         coalesce(round(sum(s.price), 2), 0)
    INTO v_count, v_sms_count, v_earned
    FROM appointments a JOIN services s ON s.id = a.service_id
   WHERE a.org_id = p_org_id
     AND a.status IN ('approved','completed','no_show')
     AND a.scheduled_at >= v_period_start
     AND a.scheduled_at <  v_period_start + interval '1 month';

  SELECT coalesce((SELECT amount_rolled_forward FROM billing_periods
                    WHERE org_id = p_org_id AND status <> 'open'
                    ORDER BY period_start DESC LIMIT 1), 0)
    INTO v_rolled;

  -- Same first-period waiver as the close job.
  v_base_due := CASE WHEN v_period_start = v_anchor THEN 0 ELSE coalesce(v_base, 0) END;

  SELECT jsonb_build_object(
           'billing_status', o.billing_status,
           'period_start', v_period_start,
           'period_end', v_period_start + interval '1 month',
           'appointment_count', v_count,
           'sms_enabled', o.sms_enabled,
           'sms_count', v_sms_count,
           'sms_price', v_sms_price,
           'base_fee', v_base,
           'base_due', v_base_due,
           'running_amount', round(v_base_due + v_sms_count * coalesce(v_sms_price, 0), 2),
           'earned', v_earned,
           'rolled_forward', v_rolled,
           'card', (SELECT jsonb_build_object('last4', pm.last4, 'brand', pm.brand, 'expires_at', pm.expires_at)
                      FROM org_payment_methods pm
                     WHERE pm.org_id = o.id AND pm.is_default AND pm.status = 'active' LIMIT 1))
    INTO v_result
    FROM organisations o WHERE o.id = p_org_id;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_org_billing_status IS
  'Live billing meter for one org: flat base fee (0 during the first period), '
  'the SMS add-on state and its per-appointment count/price, gross earned, and '
  'the card on file.';

-- ------------------------------------------------------------
-- 5. platform_billing_health (superadmin) still priced the retired model.
--
--    Its revenue projection multiplied EVERY billable appointment by
--    appointment_price. Under the new model that number means nothing: the
--    per-appointment charge now applies only to SMS-billable rows, and the base
--    fee is per org, not per appointment.
--
--    Patched by splicing the live definition — the function is long, and
--    re-transcribing a long body from a repo file is the failure mode this
--    codebase has already been bitten by twice. Each anchor below occurs exactly
--    once. Re-runnable: it exits if the patch is already applied.
--
--    revenue_by_month now reports SMS revenue only. Base-fee revenue is not
--    projected from appointments because it does not come from them — read it
--    from billing_periods.amount_due, which is what was actually invoiced.
-- ------------------------------------------------------------
DO $outer$
DECLARE
  v_def text;
  v_oid oid;
  v_price_anchor  constant text := E'(billing_config ->> ''appointment_price'')::numeric';
  v_price_new     constant text := E'(billing_config ->> ''sms_appointment_price'')::numeric';
  v_key_anchor    constant text := E'''appointment_price'', v_price,';
  v_key_new       constant text := E'''sms_appointment_price'', v_price,';
  v_filter_anchor constant text := E'AND (a.status IN (''approved'',''completed'',''no_show'') OR a.billable_locked_at IS NOT NULL)';
  v_filter_new    constant text := E'AND a.sms_billable\n             AND (a.status IN (''approved'',''completed'',''no_show'') OR a.billable_locked_at IS NOT NULL)';
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'platform_billing_health';

  IF v_oid IS NULL THEN
    RAISE NOTICE 'platform_billing_health not found, skipping';
    RETURN;
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('sms_appointment_price' in v_def) > 0 THEN
    RAISE NOTICE 'platform_billing_health: already on the new price list';
    RETURN;
  END IF;

  IF position(v_price_anchor in v_def) = 0
     OR position(v_key_anchor in v_def) = 0
     OR position(v_filter_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'platform_billing_health: expected anchors not found — inspect the live definition before retrying';
  END IF;

  v_def := replace(v_def, v_price_anchor, v_price_new);
  v_def := replace(v_def, v_key_anchor, v_key_new);
  v_def := replace(v_def, v_filter_anchor, v_filter_new);
  EXECUTE v_def;
  RAISE NOTICE 'platform_billing_health: revenue now reflects SMS-billable appointments';
END
$outer$;
