-- ============================================================
-- 20260817120000_superadmin_billing_exempt.sql
--
-- Superadmin-owned organisations are not billed: no monthly invoice, no
-- dunning, and never blocked from taking bookings (so no pay-now modal).
--
-- ── WHY A GUARDED COLUMN AND NOT A DERIVED CHECK ────────────────────────────
-- The obvious implementation — "exempt if this org's owner is a superadmin" —
-- is SELF-GRANTABLE and was rejected. Two tenant-writable paths lead there:
--
--   1. `org_members_insert` WITH CHECK allows `get_user_org_role(org_id)='owner'`
--      with NO constraint on the inserted `user_id` or `role`, so any owner can
--      insert (their_org, <someone else's uuid>, 'owner').
--   2. `organisations_update` USING `get_user_org_role(id)='owner'` covers the
--      whole row, including `owner_id` — nothing pins it.
--
-- and the superadmin's uuid is not secret: `VITE_SUPERADMIN_USER_ID` is a
-- VITE_-prefixed var, so Vite inlines it into the shipped browser bundle. Any
-- business owner could therefore have pointed their org at a superadmin and
-- stopped paying. The exemption is instead an explicit column that a tenant
-- cannot write at all:
--
--   * INSERT — `pin_org_billing_exempt` OVERWRITES whatever the client sent with
--     the server's own `is_superadmin()` answer for the real caller.
--   * UPDATE — `prevent_billing_self_update` rejects any change, exactly as it
--     already does for `billing_status` (service role / superadmin / the
--     transaction-local `app.internal_billing` GUC only).
--
-- Enforcement is in the DATABASE, on the same predicate every write path already
-- consults (`org_can_accept_appointment`), so the UI cannot be the bypass either.
-- ============================================================

-- --------------------------------------------------------
-- 1. The flag.
-- --------------------------------------------------------
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organisations.billing_exempt IS
  'True = this org is never invoiced and never blocked for non-payment '
  '(superadmin-owned). NOT tenant-writable: pinned on INSERT by '
  'pin_org_billing_exempt and frozen on UPDATE by prevent_billing_self_update. '
  'Deliberately NOT derived from owner_id/org_members — both are tenant-writable, '
  'which would make the exemption self-grantable (20260817120000).';

-- --------------------------------------------------------
-- 2. INSERT: the server decides, not the client.
--    Assigns unconditionally, so a crafted `billing_exempt: true` in a REST
--    insert is discarded. Trusted contexts (service role / superadmin) may still
--    create an exempt org because is_superadmin() is true for them; the service
--    role has auth.uid() IS NULL and gets `false`, which is the safe default —
--    a superadmin can flip it afterwards.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION pin_org_billing_exempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.billing_exempt := coalesce(is_superadmin(), false);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION pin_org_billing_exempt IS
  'BEFORE INSERT on organisations: overwrites any client-supplied billing_exempt '
  'with the server''s is_superadmin() answer for the calling user.';

REVOKE ALL ON FUNCTION pin_org_billing_exempt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pin_org_billing_exempt ON organisations;
CREATE TRIGGER trg_pin_org_billing_exempt
  BEFORE INSERT ON organisations
  FOR EACH ROW
  EXECUTE FUNCTION pin_org_billing_exempt();

-- --------------------------------------------------------
-- 3. UPDATE: freeze it, alongside billing_status.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_billing_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.billing_status IS DISTINCT FROM OLD.billing_status) THEN
    IF NOT (auth.uid() IS NULL OR is_superadmin()
         OR coalesce(current_setting('app.internal_billing', true), '') = '1') THEN
      RAISE EXCEPTION 'not_authorized: billing_status changes only via payment or superadmin';
    END IF;
  END IF;

  IF (NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt) THEN
    IF NOT (auth.uid() IS NULL OR is_superadmin()
         OR coalesce(current_setting('app.internal_billing', true), '') = '1') THEN
      RAISE EXCEPTION 'not_authorized: billing_exempt is set by the platform, not the organisation';
    END IF;
  END IF;

  RETURN NEW;
END; $function$;

-- --------------------------------------------------------
-- 4. Never block an exempt org from taking bookings.
--    Same single predicate the BEFORE INSERT trigger, create-payment, the
--    reschedule RPC and the public booking page all consult.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT billing_exempt OR billing_status = 'active'
    FROM organisations WHERE id = p_org_id;
$function$;

COMMENT ON FUNCTION org_can_accept_appointment IS
  'True while the org is billing ''active'', or unconditionally when '
  'billing_exempt (superadmin-owned, 20260817120000). Both ''past_due'' and '
  '''suspended'' block a non-exempt org. Returns NULL when the org does not '
  'exist (create-payment distinguishes that case). Consulted by '
  'trg_enforce_appointment_limit, create-payment, reschedule_appointment_slot '
  'and the public booking page.';

-- --------------------------------------------------------
-- 5. Never open an invoice for an exempt org.
--    Same body as 20260804120000_remove_deposits, plus the early exit — so no
--    billing_periods row, no line items and no billing_notice notification.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_billing_period_for_org(p_org_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor timestamptz; v_price numeric(10,2); v_min numeric(10,2); v_notice int;
  v_s timestamptz; v_end timestamptz; v_incoming numeric(10,2) := 0;
  v_count int; v_amount numeric(10,2); v_status text; v_rolled_out numeric(10,2) := 0;
  v_notified timestamptz; v_bp_id uuid; v_owner uuid; v_exempt boolean;
BEGIN
  SELECT o.usage_anchor, o.owner_id, o.billing_exempt,
         (pc.billing_config ->> 'appointment_price')::numeric,
         (pc.billing_config ->> 'minimum_charge')::numeric,
         (pc.billing_config ->> 'notice_days')::int
    INTO v_anchor, v_owner, v_exempt, v_price, v_min, v_notice
    FROM organisations o CROSS JOIN platform_config pc WHERE o.id = p_org_id AND pc.id = 1;
  IF v_anchor IS NULL THEN RETURN NULL; END IF;
  -- Superadmin-owned: nothing is ever billed.
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
  SELECT count(*)::int INTO v_count FROM appointments a
   WHERE a.org_id = p_org_id AND a.status IN ('approved','completed','no_show')
     AND a.scheduled_at >= v_s AND a.scheduled_at < v_end;
  v_amount := round(v_count * v_price + v_incoming, 2);
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
  INSERT INTO billing_line_items (billing_period_id, appointment_id, amount)
  SELECT v_bp_id, a.id, v_price FROM appointments a
   WHERE a.org_id = p_org_id AND a.status IN ('approved','completed','no_show')
     AND a.scheduled_at >= v_s AND a.scheduled_at < v_end
  ON CONFLICT (appointment_id) DO NOTHING;
  IF v_status = 'pending' AND v_owner IS NOT NULL THEN
    INSERT INTO notifications (org_id, user_id, type, title, body)
    VALUES (p_org_id, v_owner, 'billing_notice', 'მოახლოებული გადახდა',
            format('თქვენი %s-ის ინვოისი ₾%s ჩამოიჭრება %s დღეში.', to_char(v_s, 'Mon YYYY'), v_amount, v_notice));
  END IF;
  RETURN v_bp_id;
END; $function$;

-- --------------------------------------------------------
-- 6. Also skip an exempt org when charging, belt-and-braces: with (5) there is
--    nothing left to charge, but a period opened BEFORE the org became exempt
--    would otherwise still be attempted.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION charge_billing_period(p_id uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_status text; v_notified timestamptz; v_next timestamptz;
  v_notice int; v_provider text; v_bill text; v_exempt boolean;
BEGIN
  SELECT bp.org_id, bp.status, bp.notified_at, bp.next_retry_at,
         (pc.billing_config ->> 'notice_days')::int, o.billing_status, o.billing_exempt
    INTO v_org, v_status, v_notified, v_next, v_notice, v_bill, v_exempt
    FROM billing_periods bp
    JOIN organisations o ON o.id = bp.org_id
    CROSS JOIN platform_config pc
   WHERE bp.id = p_id AND pc.id = 1 FOR UPDATE OF bp;
  IF v_org IS NULL THEN RETURN 'not_found'; END IF;
  IF coalesce(v_exempt, false) THEN RETURN 'exempt'; END IF;
  IF v_status NOT IN ('pending', 'failed') THEN RETURN 'not_chargeable'; END IF;
  IF v_bill = 'suspended' THEN RETURN 'suspended'; END IF;
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

-- --------------------------------------------------------
-- 7. Backfill. Runs with auth.uid() IS NULL (migration context), so the guard
--    above permits it. Existing superadmin-owned orgs become exempt, their
--    outstanding invoices are waived, and any dunning state is cleared.
-- --------------------------------------------------------
UPDATE organisations o
   SET billing_exempt = true
  FROM superadmins s
 WHERE s.user_id = o.owner_id
   AND o.billing_exempt = false;

UPDATE billing_periods bp
   SET status = 'waived', amount_due = 0, amount_rolled_forward = 0,
       next_retry_at = NULL, last_error = NULL
  FROM organisations o
 WHERE o.id = bp.org_id
   AND o.billing_exempt
   AND bp.status IN ('pending', 'failed');

UPDATE organisations
   SET billing_status = 'active'
 WHERE billing_exempt
   AND billing_status <> 'active';
