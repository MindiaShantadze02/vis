-- ============================================================
-- 20260817140000_online_payment_toggle.sql
--
-- Let a business run ON SITE ONLY.
--
-- Until now `payment_config` could switch on-site off (in_person.enabled) but
-- online was implicit and always available, so the three sensible policies
-- were only two: "online" and "online + on site". A shop that takes cash at the
-- counter had no way to say so, and every customer was pushed to the gateway.
--
--   payment_config.online.enabled — may the customer pay online? (default true)
--
-- Backfilled explicitly so the settings page reflects a real stored value
-- rather than an implied default. Reading code still treats a missing key as
-- enabled, so an org created between deploys behaves as before.
-- ============================================================

UPDATE public.organisations
   SET payment_config = jsonb_set(
         COALESCE(payment_config, '{}'::jsonb),
         '{online}',
         '{"enabled": true}'::jsonb,
         true
       )
 WHERE payment_config -> 'online' IS NULL;

-- ------------------------------------------------------------
-- Make the on-site switch mean something on the guest path.
--
-- normalize_guest_appointment is what a public booking hits when it is NOT
-- going through the gateway: it pins status/payment fields and refuses a
-- service that requires a deposit. It never checked whether the business
-- actually accepts on-site payment, so an org running online-only could still
-- be booked without prepayment by posting the insert directly.
--
-- Now that "online only" is a policy a business can rely on, enforce it here.
-- Members, superadmins and the service-role API path return early (unchanged),
-- so this only constrains anonymous bookings.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_guest_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_duration int;
  v_price    numeric;
  v_s_dtype  text;
  v_s_dval   numeric;
  v_o_dtype  text;
  v_o_dval   numeric;
  v_dtype    text;
  v_dval     numeric;
  v_deposit  numeric;
  v_onsite   boolean;
BEGIN
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  SELECT s.duration_minutes, s.price, s.deposit_type, s.deposit_value
    INTO v_duration, v_price, v_s_dtype, v_s_dval
    FROM services s
   WHERE s.id = NEW.service_id AND s.org_id = NEW.org_id AND s.is_active;
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

  SELECT o.deposit_type,
         o.deposit_value,
         COALESCE((o.payment_config -> 'in_person' ->> 'enabled')::boolean, true)
    INTO v_o_dtype, v_o_dval, v_onsite
    FROM organisations o WHERE o.id = NEW.org_id;

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

  -- A ₾0 service has no other way to check out, so it stays bookable even for
  -- an online-only business (create-payment rejects a zero amount outright).
  IF NOT v_onsite AND COALESCE(v_price, 0) > 0 THEN
    RAISE EXCEPTION 'in_person_not_allowed';
  END IF;

  NEW.status            := 'approved';
  NEW.payment_status    := 'unpaid';
  NEW.payment_method    := 'in_person';
  NEW.payment_provider  := NULL;
  NEW.payment_reference := NULL;
  NEW.admin_notes       := NULL;

  RETURN NEW;
END;
$function$;
