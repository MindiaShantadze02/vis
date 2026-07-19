-- Security review 2026-07-19 — two hardening fixes.
--
-- F1 (deposit bypass): the "deposit forces online prepayment" rule was enforced
-- only client-side (Step3 form). A guest with an OTP could call the anon RPC
-- create_guest_booking directly (or otherwise insert straight into appointments)
-- for a deposit-required service and get a confirmed in-person/unpaid booking,
-- skipping the deposit. We extend normalize_guest_appointment (the BEFORE INSERT
-- trigger that already gates the guest path) to reject that: if the service's
-- resolved deposit is > 0, a guest insert raises 'deposit_required'. Legitimate
-- deposit bookings are unaffected — they go create-payment → payment-webhook,
-- which inserts as service_role and short-circuits this trigger above.
--
-- The deposit resolution mirrors resolveDeposit()+computeDeposit() in
-- client/src/lib/deposit.ts and the create-payment edge function (service
-- override wins; a NULL service type inherits the org default).

CREATE OR REPLACE FUNCTION public.normalize_guest_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_require_approval boolean;
  v_duration         int;
  v_price            numeric;
  v_s_dtype          text;
  v_s_dval           numeric;
  v_o_dtype          text;
  v_o_dval           numeric;
  v_dtype            text;
  v_dval             numeric;
  v_deposit          numeric;
BEGIN
  -- Trusted paths keep their explicit fields: the payment-webhook (service_role)
  -- writing a paid/deposit_paid booking, a superadmin, or the org's own admin.
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  SELECT s.duration_minutes, s.price, s.deposit_type, s.deposit_value
    INTO v_duration, v_price, v_s_dtype, v_s_dval
    FROM services s
   WHERE s.id = NEW.service_id
     AND s.org_id = NEW.org_id
     AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;
  NEW.duration_minutes := v_duration;

  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = NEW.service_id
       AND ss.member_id = NEW.staff_id
       AND m.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  SELECT o.require_approval, o.deposit_type, o.deposit_value
    INTO v_require_approval, v_o_dtype, v_o_dval
    FROM organisations o
   WHERE o.id = NEW.org_id;

  -- Resolve the deposit (service override wins; NULL service type inherits the
  -- org default) and reject the guest path if one is owed — it must be prepaid.
  IF v_s_dtype IS NOT NULL THEN
    v_dtype := v_s_dtype; v_dval := v_s_dval;
  ELSE
    v_dtype := v_o_dtype; v_dval := v_o_dval;
  END IF;

  v_deposit := CASE
    WHEN v_dtype IS NULL OR v_dtype = 'none' OR v_dval IS NULL THEN 0
    WHEN v_dtype = 'fixed'   THEN least(round(v_dval, 2), round(coalesce(v_price, 0), 2))
    WHEN v_dtype = 'percent' THEN least(round(coalesce(v_price, 0) * v_dval / 100, 2), round(coalesce(v_price, 0), 2))
    ELSE 0
  END;

  IF v_deposit > 0 THEN
    RAISE EXCEPTION 'deposit_required';
  END IF;

  NEW.status            := CASE WHEN coalesce(v_require_approval, true)
                                THEN 'pending' ELSE 'approved' END;
  NEW.payment_status    := 'unpaid';
  NEW.payment_method    := 'in_person';
  NEW.payment_provider  := NULL;
  NEW.payment_reference := NULL;
  NEW.admin_notes       := NULL;

  RETURN NEW;
END;
$function$;

-- F2 (over-granted EXECUTE, defense-in-depth): trigger functions never need a
-- direct EXECUTE grant (the trigger fires regardless), and the superadmin
-- mutators must never be reachable by anon. Revoke the blanket PUBLIC grant and
-- the anon/authenticated grants; owner/service_role keep what they need.
DO $$
DECLARE
  fn text;
  trigger_fns text[] := ARRAY[
    'enforce_appointment_limit','enforce_booking_advance_window',
    'enforce_booking_verification','enforce_slot_capacity','enforce_staff_limit',
    'normalize_guest_appointment','notify_new_appointment',
    'notify_setup_request_completed','prevent_billing_self_update',
    'prevent_role_escalation','record_appointment_overage',
    'reset_usage_anchor_on_tier_change','send_appointment_sms','update_updated_at'
  ];
BEGIN
  FOREACH fn IN ARRAY trigger_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.add_superadmin(text)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_superadmin(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_setup_request(uuid) FROM PUBLIC, anon;
