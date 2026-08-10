-- ============================================================
-- 20260806120000_readd_deposits.sql
--
-- Re-add the deposit / prepayment feature that was removed in
-- 20260804120000_remove_deposits.sql. Restores the full prior behaviour
-- (migrations 089/090/091 + the guard in 20260719120000):
--   * per-service deposit override (none/fixed/percent) + per-org default
--   * partial pay-online-at-booking with the 'deposit_paid' payment status
--   * deposit_refundable master toggle gating in-window cancel refunds
--   * analytics deposits_collected metric
--   * normalize_guest_appointment rejects a guest insert when a deposit is owed
--
-- get_public_org is recreated on top of the CURRENT signature (which already
-- carries cover_url from 20260804170000) plus the three deposit fields.
-- cancellation_window_hours was NOT dropped by the removal, so it is left as-is.
-- ============================================================

-- 1. Per-service deposit (nullable = inherit org default).
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS deposit_type  text CHECK (deposit_type IN ('none', 'fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS deposit_value numeric(10,2);

COMMENT ON COLUMN services.deposit_type IS
  'Per-service deposit: NULL inherits the org default; ''none'' overrides it to '
  'no deposit; ''fixed''/''percent'' set a service-specific deposit (value in '
  'deposit_value — ₾ for fixed, 0–100 for percent).';

-- 2. Org-level deposit default + refundable toggle (cancellation_window_hours
--    already exists — it was kept by the removal migration).
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS deposit_type       text NOT NULL DEFAULT 'none'
    CHECK (deposit_type IN ('none', 'fixed', 'percent')),
  ADD COLUMN IF NOT EXISTS deposit_value      numeric(10,2),
  ADD COLUMN IF NOT EXISTS deposit_refundable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN organisations.deposit_type IS
  'Org default deposit applied to services that don''t override it. ''none'' = no deposit by default.';
COMMENT ON COLUMN organisations.deposit_refundable IS
  'Whether an in-window cancel refunds the deposit at all. false = never returned on cancel.';

-- 3. Deposit value constraints (from 091).
ALTER TABLE services
  ADD CONSTRAINT services_deposit_percent_range
    CHECK (deposit_type <> 'percent'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0 AND deposit_value <= 100)),
  ADD CONSTRAINT services_deposit_fixed_nonneg
    CHECK (deposit_type <> 'fixed'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0));

ALTER TABLE organisations
  ADD CONSTRAINT organisations_deposit_percent_range
    CHECK (deposit_type <> 'percent'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0 AND deposit_value <= 100)),
  ADD CONSTRAINT organisations_deposit_fixed_nonneg
    CHECK (deposit_type <> 'fixed'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0));

-- 4. deposit_paid payment status — deposit cleared, balance due in person.
ALTER TABLE appointments DROP CONSTRAINT appointments_payment_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_payment_status_check
  CHECK (payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'deposit_paid'::text, 'refunded'::text]));

-- 5. Parked bookings remember whether the charge is a partial deposit.
ALTER TABLE pending_bookings
  ADD COLUMN IF NOT EXISTS is_deposit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pending_bookings.is_deposit IS
  'True when `amount` is a partial deposit (balance due in person) rather than '
  'full payment. Set by create-payment; read by payment-webhook to choose '
  'deposit_paid vs paid.';

-- 6. normalize_guest_appointment — restore the deposit_required guard (guard
--    migration 20260719120000). A guest insert for a deposit-owing service is
--    rejected; legitimate deposit bookings go create-payment → payment-webhook
--    (service_role) and short-circuit this trigger.
CREATE OR REPLACE FUNCTION public.normalize_guest_appointment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  SELECT o.require_approval, o.deposit_type, o.deposit_value
    INTO v_require_approval, v_o_dtype, v_o_dval
    FROM organisations o WHERE o.id = NEW.org_id;

  -- Resolve the deposit (service override wins; NULL service type inherits org).
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

-- 7. get_manage_context — restore deposit_refundable gating (from 092).
CREATE OR REPLACE FUNCTION public.get_manage_context(p_appointment_id uuid)
  RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'org_id',                    o.id,
    'org_name',                  o.name,
    'slug',                      o.slug,
    'booking_theme',             o.booking_theme,
    'service_id',                s.id,
    'service_name',              s.name,
    'price',                     s.price,
    'scheduled_at',              a.scheduled_at,
    'duration_minutes',          a.duration_minutes,
    'staff_id',                  a.staff_id,
    'staff_name',                m.display_name,
    'status',                    a.status,
    'payment_status',            a.payment_status,
    'phone_masked',              '••••' || right(c.phone_number, 2),
    'cancellation_window_hours', o.cancellation_window_hours,
    'deposit_refundable',        o.deposit_refundable,
    'can_manage',                (a.status IN ('pending', 'approved') AND a.scheduled_at > now()),
    'refund_on_cancel',          (
       a.status IN ('pending', 'approved') AND a.scheduled_at > now()
       AND a.payment_status IN ('paid', 'deposit_paid') AND a.payment_reference IS NOT NULL
       AND o.deposit_refundable
       AND a.scheduled_at >= now() + make_interval(hours => o.cancellation_window_hours)
    )
  )
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  JOIN services s      ON s.id = a.service_id
  JOIN customers c     ON c.id = a.customer_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.id = p_appointment_id;
$function$;

-- 8. get_org_analytics — restore the deposits_collected metric (count of
--    prepaid appointments), added back to the current deposit-free body.
CREATE OR REPLACE FUNCTION public.get_org_analytics(p_org_id uuid, p_from date, p_to date)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  WITH appts AS (
    SELECT a.status, a.payment_status, a.customer_id, a.staff_id, s.price,
           (a.scheduled_at AT TIME ZONE 'Asia/Tbilisi') AS local_at
      FROM appointments a
      JOIN services s ON s.id = a.service_id
     WHERE a.org_id = p_org_id
       AND (a.scheduled_at AT TIME ZONE 'Asia/Tbilisi')::date BETWEEN p_from AND p_to
  ),
  base AS (
    SELECT
      COALESCE(SUM(price) FILTER (WHERE status = 'completed'), 0)          AS revenue,
      COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'rejected'))      AS bookings,
      COUNT(*) FILTER (WHERE status = 'completed')                         AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled')                         AS cancelled,
      COUNT(*) FILTER (WHERE status = 'no_show')                           AS no_show,
      COUNT(*) FILTER (WHERE payment_status IN ('paid', 'deposit_paid'))   AS deposits,
      COUNT(*)                                                             AS total_all
    FROM appts
  ),
  staff_rev AS (
    SELECT COALESCE(m.display_name, '—') AS name, COALESCE(SUM(a.price), 0) AS revenue
      FROM appts a
      LEFT JOIN org_members m ON m.id = a.staff_id
     WHERE a.status = 'completed'
     GROUP BY 1 ORDER BY 2 DESC
  ),
  weekday AS (
    SELECT EXTRACT(isodow FROM local_at)::int AS d, COUNT(*) AS c
      FROM appts WHERE status NOT IN ('cancelled', 'rejected') GROUP BY 1
  ),
  hour AS (
    SELECT EXTRACT(hour FROM local_at)::int AS h, COUNT(*) AS c
      FROM appts WHERE status NOT IN ('cancelled', 'rejected') GROUP BY 1
  ),
  repeat_c AS (
    SELECT customer_id, COUNT(*) AS n FROM appts WHERE status = 'completed' GROUP BY 1
  )
  SELECT jsonb_build_object(
    'revenue',            (SELECT revenue   FROM base),
    'bookings',           (SELECT bookings  FROM base),
    'completed',          (SELECT completed FROM base),
    'cancelled',          (SELECT cancelled FROM base),
    'no_show',            (SELECT no_show   FROM base),
    'deposits_collected', (SELECT deposits  FROM base),
    'no_show_rate',       (SELECT round(no_show::numeric  / NULLIF(completed + no_show, 0), 3) FROM base),
    'cancellation_rate',  (SELECT round(cancelled::numeric / NULLIF(total_all, 0), 3) FROM base),
    'repeat_rate',        round((SELECT count(*) FILTER (WHERE n >= 2) FROM repeat_c)::numeric
                                / NULLIF((SELECT count(*) FROM repeat_c), 0), 3),
    'revenue_by_staff',   COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue)) FROM staff_rev), '[]'::jsonb),
    'by_weekday',         (SELECT jsonb_agg(COALESCE((SELECT c FROM weekday WHERE d = g), 0) ORDER BY g) FROM generate_series(1, 7) g),
    'by_hour',            (SELECT jsonb_agg(COALESCE((SELECT c FROM hour WHERE h = g), 0) ORDER BY g) FROM generate_series(0, 23) g)
  ) INTO v;

  RETURN v;
END;
$function$;

-- 9. get_public_org — add the three deposit fields on top of the current
--    signature (which carries cover_url + cancellation_window_hours). Return
--    signature changes → DROP + CREATE.
DROP FUNCTION IF EXISTS public.get_public_org(text);
CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, cover_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, cancellation_window_hours integer, contact_email text, require_approval boolean, deposit_type text, deposit_value numeric, deposit_refundable boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT
    o.id, o.name::text, o.description, o.contact_phone, o.address, o.logo_url,
    o.cover_url,
    o.slug::text, o.booking_theme,
    COALESCE(
      (SELECT jsonb_object_agg(key, jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false)))
       FROM jsonb_each(o.payment_config)),
      '{}'::jsonb
    ) AS payment_methods,
    o.reviews_enabled,
    CASE WHEN o.reviews_enabled THEN (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.org_id = o.id) ELSE NULL END,
    CASE WHEN o.reviews_enabled THEN (SELECT count(*)::integer FROM reviews r WHERE r.org_id = o.id) ELSE 0 END,
    o.cancellation_window_hours,
    o.contact_email, o.require_approval,
    o.deposit_type, o.deposit_value, o.deposit_refundable
  FROM organisations o WHERE o.slug = p_slug;
$function$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;
