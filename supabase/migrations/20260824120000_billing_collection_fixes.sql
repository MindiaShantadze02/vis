-- ============================================================
-- 20260824120000_billing_collection_fixes.sql
--
-- Exploratory testing of the billing path (2026-08-19) found four ways an
-- organisation ends up using Vis without paying for it. Three are exploitable
-- by an ordinary owner from the browser; one is a silent regression.
--
-- Every function below was rebuilt from the LIVE pg_get_functiondef body, not
-- from the migration files — because finding #2 is exactly what happens when
-- you CREATE OR REPLACE from a stale copy.
-- ============================================================

-- ── 1. usage_anchor was pinned on UPDATE but not on INSERT ─────────────────
-- 20260823120000 froze usage_anchor against UPDATE, closing the "push the
-- anchor forward each month and never get invoiced" bypass. But
-- organisations_insert is WITH CHECK (auth.uid() IS NOT NULL) — no column list
-- — so the same bypass was still available one step earlier: create the org
-- with usage_anchor = '2099-01-01' and close_billing_period_for_org's period
-- walk exits immediately (v_end > now()) and returns NULL forever, while
-- org_can_accept_appointment still returns true. Verified as a real owner.
--
-- owner_id gets the same treatment: at INSERT a user could name any uuid as
-- owner, and organisations_select ORs owner_id = auth.uid(), so that hands a
-- stranger read access to the row.
CREATE OR REPLACE FUNCTION public.pin_org_billing_exempt()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_platform boolean := (auth.uid() IS NULL OR is_superadmin());
BEGIN
  NEW.billing_exempt := coalesce(is_superadmin(), false);

  -- The platform (service role, superadmin, concierge onboarding) may set these
  -- deliberately; a tenant may not choose its own billing clock or owner.
  IF NOT v_platform THEN
    NEW.usage_anchor := now();
    NEW.owner_id     := auth.uid();
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.pin_org_billing_exempt IS
  'BEFORE INSERT on organisations: pins billing_exempt, and for tenant callers '
  'also usage_anchor (the billing clock) and owner_id. organisations_insert has '
  'no column list, so this trigger is the column-level access control on insert '
  'exactly as prevent_billing_self_update is on update.';

-- ── 2. REGRESSION: the "no card = free forever" gap had been reopened ──────
-- 20260729120000_no_card_dunning.sql fixed charge_billing_period so a charge
-- that comes due with no card on file is an uncollectable FAILURE routed into
-- dunning. 20260817120000_superadmin_billing_exempt.sql then re-declared the
-- function from a pre-fix copy to add the billing_exempt check, silently
-- restoring `RETURN 'no_card'` — a soft skip. Live behaviour today: remove your
-- card and the invoice sits 'pending' forever, the org stays 'active', keeps
-- taking bookings, is never dunned and never suspended.
--
-- That also made the promise in 20260820120000_remove_org_card.sql's header
-- ("still routes the unpaid charge into dunning, so this cannot dodge
-- collection") false at the moment card removal shipped.
--
-- Also changed: a SUSPENDED org is normally not auto-retried because there is
-- nothing new to try. A card that has since been put on file IS the new thing,
-- so suspension no longer blocks the attempt when one exists. Together with
-- store_org_card re-arming the retry below, this is what makes "they get
-- charged once they add the card back" actually true.
CREATE OR REPLACE FUNCTION public.charge_billing_period(p_id uuid)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_status text; v_notified timestamptz; v_next timestamptz;
  v_notice int; v_provider text; v_bill text; v_exempt boolean;
  v_amount numeric(10,2); v_has_card boolean;
BEGIN
  SELECT bp.org_id, bp.status, bp.notified_at, bp.next_retry_at, bp.amount_due,
         (pc.billing_config ->> 'notice_days')::int, o.billing_status, o.billing_exempt
    INTO v_org, v_status, v_notified, v_next, v_amount, v_notice, v_bill, v_exempt
    FROM billing_periods bp
    JOIN organisations o ON o.id = bp.org_id
    CROSS JOIN platform_config pc
   WHERE bp.id = p_id AND pc.id = 1 FOR UPDATE OF bp;

  IF v_org IS NULL THEN RETURN 'not_found'; END IF;
  IF coalesce(v_exempt, false) THEN RETURN 'exempt'; END IF;
  IF v_status NOT IN ('pending', 'failed') THEN RETURN 'not_chargeable'; END IF;

  -- Nothing owed is never a dunning event. minimum_charge is currently 0, so a
  -- quiet month can close as 'pending' with amount_due 0; without this guard
  -- restoring the no-card failure path would suspend an org for owing ₾0.
  IF coalesce(v_amount, 0) <= 0 THEN
    UPDATE billing_periods SET status = 'waived', next_retry_at = NULL WHERE id = p_id;
    RETURN 'nothing_due';
  END IF;

  v_has_card := EXISTS (
    SELECT 1 FROM org_payment_methods
     WHERE org_id = v_org AND is_default AND status = 'active');

  IF v_bill = 'suspended' AND NOT v_has_card THEN RETURN 'suspended'; END IF;

  IF v_status = 'pending' AND (v_notified IS NULL OR now() < v_notified + make_interval(days => coalesce(v_notice, 0))) THEN
    RETURN 'notice_period';
  END IF;
  IF v_status = 'failed' AND (v_next IS NULL OR now() < v_next) THEN
    RETURN 'retry_pending';
  END IF;

  -- Due, but uncollectable → dunning, NOT a silent skip. (Restores 20260729120000.)
  IF NOT v_has_card THEN
    RETURN settle_usage_charge(p_id, false, NULL, 'no_card_on_file');
  END IF;

  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN RETURN 'provider_not_configured'; END IF;

  RETURN settle_usage_charge(p_id, true, 'mock_usage_' || gen_random_uuid()::text);
END;
$function$;
REVOKE ALL ON FUNCTION public.charge_billing_period(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Putting a card back on file collects what is owed ──────────────────
-- Previously store_org_card only inserted the row. An org that had been dunned
-- to 'suspended' had next_retry_at NULL and was skipped by charge_billing_period
-- forever, so adding a card back did nothing at all — recovery required finding
-- the "pay now" button. Now the new card re-arms the outstanding periods and
-- collection is attempted immediately.
CREATE OR REPLACE FUNCTION public.store_org_card(
  p_org_id uuid, p_provider text, p_token text, p_last4 text, p_brand text, p_expires_at date)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; r record;
BEGIN
  IF p_org_id IS NULL OR coalesce(p_token,'') = '' THEN RAISE EXCEPTION 'invalid_card'; END IF;

  UPDATE org_payment_methods SET is_default = false, status = 'removed'
   WHERE org_id = p_org_id AND is_default AND status = 'active';

  INSERT INTO org_payment_methods (org_id, provider, token, last4, brand, expires_at, is_default, status)
  VALUES (p_org_id, coalesce(p_provider,'mock'), p_token, p_last4, p_brand, p_expires_at, true, 'active')
  RETURNING id INTO v_id;

  -- A new card is a new thing to try: make failed periods immediately due again
  -- (suspension leaves next_retry_at NULL, which would otherwise read as
  -- 'retry_pending' forever) and attempt collection now rather than waiting for
  -- the daily cron. charge_billing_period still enforces notice windows, so a
  -- charge that is not yet due is untouched.
  UPDATE billing_periods SET next_retry_at = now()
   WHERE org_id = p_org_id AND status = 'failed';

  FOR r IN SELECT id FROM billing_periods
            WHERE org_id = p_org_id AND status IN ('pending','failed')
            ORDER BY period_start LOOP
    PERFORM charge_billing_period(r.id);
  END LOOP;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.store_org_card(uuid, text, text, text, text, date) FROM PUBLIC, anon, authenticated;

-- ── 4. Retroactive cancellation wiped the bill ────────────────────────────
-- close_billing_period_for_org counts appointments by their CURRENT status at
-- close time, and the close job runs daily at 03:00 UTC. appointments_member_update
-- is USING (org_id = ANY get_user_org_ids()) with no column or status restriction,
-- so an owner could mass-cancel already-delivered appointments the night before
-- close. Verified on the seed org: one UPDATE moved 180 elapsed appointments to
-- 'cancelled', taking a ₾133 month to ₾0.
--
-- Fix: once an appointment has elapsed in a billable state, downgrading it stamps
-- an immutable marker, and the close job counts the marker. Cancelling a FUTURE
-- appointment is untouched — the service was not delivered, so it is not billable.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS billable_locked_at timestamptz;

COMMENT ON COLUMN appointments.billable_locked_at IS
  'Set when an already-elapsed appointment is moved out of a billable status. '
  'The occurrence still counts for billing — the service window had passed. '
  'Cancelling a future appointment does not set this.';

CREATE OR REPLACE FUNCTION public.lock_billable_appointment()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF OLD.status IN ('approved','completed','no_show')
     AND NEW.status NOT IN ('approved','completed','no_show')
     AND OLD.scheduled_at < now()
  THEN
    NEW.billable_locked_at := coalesce(OLD.billable_locked_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_billable_appointment ON appointments;
CREATE TRIGGER trg_lock_billable_appointment
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION lock_billable_appointment();

CREATE OR REPLACE FUNCTION public.close_billing_period_for_org(p_org_id uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
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
   WHERE a.org_id = p_org_id
     AND (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL)
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
   WHERE a.org_id = p_org_id
     AND (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL)
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
REVOKE ALL ON FUNCTION public.close_billing_period_for_org(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Grant hygiene on the billing ledger ────────────────────────────────
-- anon AND authenticated held table-level INSERT/UPDATE/DELETE/TRUNCATE on
-- billing_periods, billing_line_items and billing_events, plus DELETE on
-- payment_log. Only SELECT policies exist, so RLS reduces those writes to zero
-- rows today — but the ledger that decides who owes money should not be one
-- stray permissive policy away from being editable by the party being billed.
REVOKE ALL ON public.billing_periods    FROM anon, authenticated;
REVOKE ALL ON public.billing_line_items FROM anon, authenticated;
REVOKE ALL ON public.billing_events     FROM anon, authenticated;
REVOKE ALL ON public.payment_log        FROM anon, authenticated;

GRANT SELECT ON public.billing_periods    TO authenticated;
GRANT SELECT ON public.billing_line_items TO authenticated;
GRANT SELECT ON public.billing_events     TO authenticated;
GRANT SELECT ON public.payment_log        TO authenticated;  -- superadmin-only via RLS

-- ── 6. Pin the billing PERIOD too, not just the billable flag ─────────────
-- The lock above still left a two-step way around it: appointments_member_update
-- has no column restriction, so an owner can set scheduled_at directly (the
-- reschedule RPC refuses anything not 'approved', but it is not the only door).
-- Push an elapsed appointment into next year, then cancel it while it is
-- "future", and neither the lock nor the period range catches it.
--
-- So the period is frozen at the same moment the lock is stamped. Untouched
-- appointments keep using scheduled_at.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS billable_period_at timestamptz;

COMMENT ON COLUMN appointments.billable_period_at IS
  'Billing period anchor frozen when an already-elapsed appointment is tampered '
  'with (status downgraded or scheduled_at moved). close_billing_period_for_org '
  'counts by coalesce(billable_period_at, scheduled_at), so the occurrence '
  'cannot be walked into another month.';

CREATE OR REPLACE FUNCTION public.lock_billable_appointment()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF OLD.status IN ('approved','completed','no_show')
     AND OLD.scheduled_at < now()
     AND (NEW.status NOT IN ('approved','completed','no_show')
          OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at)
  THEN
    NEW.billable_locked_at := coalesce(OLD.billable_locked_at, now());
    NEW.billable_period_at := coalesce(OLD.billable_period_at, OLD.scheduled_at);
  END IF;
  RETURN NEW;
END;
$function$;

-- close_billing_period_for_org's two appointment predicates become:
--   AND (a.status IN ('approved','completed','no_show') OR a.billable_locked_at IS NOT NULL)
--   AND coalesce(a.billable_period_at, a.scheduled_at) >= v_s
--   AND coalesce(a.billable_period_at, a.scheduled_at) <  v_end
-- (applied on the cloud as migration billing_pin_period_and_owner_only_card)

-- ── 7. Card + pay-now are OWNER actions ──────────────────────────────────
-- Both RPCs checked membership via get_user_org_ids(), which includes 'staff'.
-- A staff account could therefore pull the business's card off file (sabotaging
-- it into dunning) or trigger a payment. Not reachable today — all 16 staff rows
-- have user_id NULL — but it activates the moment a staff member is invited with
-- a login. organisations_update is already owner-gated; this matches it.
CREATE OR REPLACE FUNCTION public.remove_org_card(p_org_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_n int;
BEGIN
  -- coalesce BOTH legs: get_user_org_role() returns NULL for an org you are not
  -- a member of, so `role = 'owner'` is NULL, `NOT (NULL OR false)` is NULL, and
  -- `IF NULL THEN RAISE` never fires — the guard would fail OPEN for exactly the
  -- callers it exists to stop. Caught by billing.spec's cross-org test; on
  -- pay_org_outstanding it would have let any authenticated user settle another
  -- org's invoices. Same trap as 20260723150000:180.
  IF NOT (coalesce(get_user_org_role(p_org_id) = 'owner', false)
          OR coalesce(is_superadmin(), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE org_payment_methods
     SET is_default = false, status = 'removed'
   WHERE org_id = p_org_id AND is_default AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.remove_org_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_org_card(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_org_outstanding(p_org_id uuid)
  RETURNS int LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE r record; v_n int := 0; v_provider text;
BEGIN
  -- coalesce BOTH legs: get_user_org_role() returns NULL for an org you are not
  -- a member of, so `role = 'owner'` is NULL, `NOT (NULL OR false)` is NULL, and
  -- `IF NULL THEN RAISE` never fires — the guard would fail OPEN for exactly the
  -- callers it exists to stop. Caught by billing.spec's cross-org test; on
  -- pay_org_outstanding it would have let any authenticated user settle another
  -- org's invoices. Same trap as 20260723150000:180.
  IF NOT (coalesce(get_user_org_role(p_org_id) = 'owner', false)
          OR coalesce(is_superadmin(), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT coalesce(payment_provider, 'mock') INTO v_provider FROM platform_config WHERE id = 1;
  IF v_provider <> 'mock' THEN RAISE EXCEPTION 'provider_not_configured'; END IF;
  FOR r IN SELECT id FROM billing_periods WHERE org_id = p_org_id AND status IN ('pending','failed') ORDER BY period_start LOOP
    PERFORM settle_usage_charge(r.id, true, 'mock_paynow_' || gen_random_uuid()::text);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.pay_org_outstanding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_org_outstanding(uuid) TO authenticated;
