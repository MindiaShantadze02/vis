-- ============================================================
-- 20260724120000_retire_billing_model.sql  (BILLING_PLAN T1.2)
--
-- Deletes the tier / credit / trial model outright (pre-production, no live
-- customers to migrate). Post-paid billing replaces it: org_subscription_state's
-- trial/active/expired collapses to organisations.billing_status, and the
-- consume-on-insert / refund-on-cancel credit machinery is gone — counting at
-- period close (T1.3) replaces reconciliation.
--
-- Sequenced so nothing is left pointing at a dropped object:
--   1. rewrite functions that reference the old model,
--   2. drop the old triggers + functions,
--   3. add get_org_billing_status,
--   4. clean payment_log, drop old tables, then old columns.
-- ============================================================

-- ── 1. Rewrite functions off the old model ─────────────────────────────────────

-- The only booking gate now: a suspended org can't take new bookings.
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT billing_status <> 'suspended' FROM organisations WHERE id = p_org_id;
$function$;
COMMENT ON FUNCTION org_can_accept_appointment IS
  'False only when the org is billing-suspended (unpaid past grace). Drives the '
  'enforce_appointment_limit insert guard and the public booking pre-check.';

-- Reminders: skip suspended orgs (parity with the old "skip expired" rule).
CREATE OR REPLACE FUNCTION dispatch_appointment_reminders()
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'net', 'pg_temp'
AS $function$
DECLARE
  REMINDER_LEAD constant interval := interval '24 hours';
  v_url    text;
  v_secret text;
  r        record;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret FROM platform_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT a.id
      FROM appointments a
      JOIN organisations o ON o.id = a.org_id
     WHERE a.status = 'approved'
       AND a.reminder_sent_at IS NULL
       AND a.scheduled_at > now()
       AND a.scheduled_at <= now() + REMINDER_LEAD
       AND o.billing_status <> 'suspended'
  LOOP
    UPDATE appointments SET reminder_sent_at = now() WHERE id = r.id;
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object('appointment_id', r.id, 'message_type', 'appointment_reminder'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch_appointment_reminders failed for appointment %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$function$;

-- Public sitemap slugs: hide only suspended orgs.
CREATE OR REPLACE FUNCTION list_public_booking_slugs()
  RETURNS TABLE(slug text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT o.slug::text FROM organisations o
  WHERE o.billing_status <> 'suspended'
  ORDER BY o.created_at;
$function$;

-- Seats are unlimited under post-paid (tiers gone). Keep the trigger binding as
-- a no-op rather than dropping it, so nothing depends on the old tier limits.
CREATE OR REPLACE FUNCTION enforce_staff_limit()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN NEW;  -- no seat cap; post-paid meters appointments, not staff
END;
$function$;

-- Superadmin platform stats: orgs by billing status instead of by tier.
CREATE OR REPLACE FUNCTION platform_stats()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN jsonb_build_object(
    'total_orgs',           (SELECT count(*) FROM organisations),
    'total_appointments',   (SELECT count(*) FROM appointments),
    'signups_last_30d',     (SELECT count(*) FROM organisations WHERE created_at >= now() - interval '30 days'),
    'orgs_by_billing_status', (SELECT coalesce(jsonb_object_agg(billing_status, c), '{}'::jsonb)
                                 FROM (SELECT billing_status, count(*) c FROM organisations GROUP BY billing_status) t)
  );
END;
$function$;

-- Superadmin org list: expose billing_status in place of subscription_tier
-- (return signature changes → drop + recreate).
DROP FUNCTION IF EXISTS list_orgs_overview();
CREATE OR REPLACE FUNCTION list_orgs_overview()
  RETURNS TABLE(id uuid, name text, slug text, billing_status text, created_at timestamptz,
                owner_email text, owner_phone text, contact_phone text, member_count integer, usage integer)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY
    SELECT o.id, o.name::text, o.slug::text, o.billing_status, o.created_at,
           u.email::text, u.phone::text, o.contact_phone,
           (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id),
           org_usage(o.id)
      FROM organisations o
      LEFT JOIN auth.users u ON u.id = o.owner_id
     ORDER BY o.created_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION list_orgs_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_orgs_overview() TO authenticated;

-- Guard: only billing_status remains a protected column.
CREATE OR REPLACE FUNCTION prevent_billing_self_update()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.billing_status IS DISTINCT FROM OLD.billing_status) THEN
    IF NOT (auth.uid() IS NULL
         OR is_superadmin()
         OR coalesce(current_setting('app.internal_billing', true), '') = '1') THEN
      RAISE EXCEPTION 'not_authorized: billing_status changes only via payment or superadmin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Drop old triggers + functions ───────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_record_appointment_overage ON appointments;
DROP TRIGGER IF EXISTS trg_reset_usage_anchor ON organisations;

DROP FUNCTION IF EXISTS record_appointment_overage();
DROP FUNCTION IF EXISTS reset_usage_anchor_on_tier_change();
DROP FUNCTION IF EXISTS get_org_entitlements(uuid);
DROP FUNCTION IF EXISTS org_usage_info(uuid);
DROP FUNCTION IF EXISTS grant_org_credits(uuid, int);
DROP FUNCTION IF EXISTS get_credit_packs();
DROP FUNCTION IF EXISTS org_subscription_state(uuid);

-- ── 3. The single billing-status read the client needs ─────────────────────────
-- Replaces get_org_entitlements / org_usage_info. Current-period billable count
-- (occurrence date, D3; billable status set, D1), running amount, rolled-forward
-- carry, billing status, and the card-on-file summary.
CREATE OR REPLACE FUNCTION get_org_billing_status(p_org_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result       jsonb;
  v_period_start timestamptz;
  v_price        numeric(10,2);
  v_count        int;
  v_rolled       numeric(10,2);
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT current_period_start(o.usage_anchor),
         (pc.billing_config ->> 'appointment_price')::numeric
    INTO v_period_start, v_price
    FROM organisations o CROSS JOIN platform_config pc
   WHERE o.id = p_org_id AND pc.id = 1;

  -- Billable this period: occurrence in [period_start, +1 month) AND final status
  -- in {approved, completed, no_show, deposit_paid} (excludes pending/cancelled/rejected).
  SELECT count(*)::int INTO v_count
    FROM appointments a
   WHERE a.org_id = p_org_id
     AND a.status IN ('approved', 'completed', 'no_show', 'deposit_paid')
     AND a.scheduled_at >= v_period_start
     AND a.scheduled_at <  v_period_start + interval '1 month';

  -- Carry from the most recent closed period (below-floor balance rolled forward).
  SELECT coalesce((SELECT amount_rolled_forward FROM billing_periods
                    WHERE org_id = p_org_id AND status <> 'open'
                    ORDER BY period_start DESC LIMIT 1), 0)
    INTO v_rolled;

  SELECT jsonb_build_object(
           'billing_status',    o.billing_status,
           'period_start',      v_period_start,
           'period_end',        v_period_start + interval '1 month',
           'appointment_count', v_count,
           'appointment_price', v_price,
           'running_amount',    round(v_count * v_price, 2),
           'rolled_forward',    v_rolled,
           'card',              (SELECT jsonb_build_object('last4', pm.last4, 'brand', pm.brand, 'expires_at', pm.expires_at)
                                   FROM org_payment_methods pm
                                  WHERE pm.org_id = o.id AND pm.is_default AND pm.status = 'active'
                                  LIMIT 1)
         )
    INTO v_result
    FROM organisations o
   WHERE o.id = p_org_id;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION get_org_billing_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_org_billing_status(uuid) TO authenticated;

-- ── 4. payment_log: drop the subscription link + old purposes ──────────────────
DELETE FROM payment_log WHERE purpose IN ('subscription', 'credit', 'stay');
ALTER TABLE payment_log DROP COLUMN IF EXISTS subscription_payment_id;
ALTER TABLE payment_log DROP CONSTRAINT IF EXISTS payment_log_purpose_check;
ALTER TABLE payment_log ADD CONSTRAINT payment_log_purpose_check
  CHECK (purpose = ANY (ARRAY['appointment', 'usage']));

-- ── 5. Drop old tables ─────────────────────────────────────────────────────────
DROP TABLE IF EXISTS credit_consumption;
DROP TABLE IF EXISTS credit_purchases;
DROP TABLE IF EXISTS overage_events;
DROP TABLE IF EXISTS subscription_payments;

-- ── 6. Drop old platform_config + organisations columns ────────────────────────
ALTER TABLE platform_config
  DROP COLUMN IF EXISTS credit_packs,
  DROP COLUMN IF EXISTS tier_limits,
  DROP COLUMN IF EXISTS tier_prices,
  DROP COLUMN IF EXISTS tier_features,
  DROP COLUMN IF EXISTS tier_staff_limits,
  DROP COLUMN IF EXISTS tier_overage_prices;

ALTER TABLE organisations
  DROP COLUMN IF EXISTS subscription_tier,
  DROP COLUMN IF EXISTS subscription_expires_at,
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS trial_expiry_ack_at,
  DROP COLUMN IF EXISTS credit_balance;
