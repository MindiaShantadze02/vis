-- ============================================================
-- 20260804120000_remove_deposits.sql
--
-- Remove the deposit feature entirely (migrations 089/090/091 + the guard in
-- 20260719120000). Bookings are now simply: priced → paid online in full, or
-- free → no charge. There is no partial upfront deposit.
--
-- KEPT (not deposit-specific): the `no_show` appointment status, the
-- `cancellation_window_hours` policy, and self-service cancel-with-refund — but
-- refunds are now gated purely by the cancellation window (the deposit-branded
-- `deposit_refundable` master toggle is dropped; within-window online payments
-- always refund on cancel).
--
-- Functions are recreated (deposit-free) BEFORE the columns are dropped.
-- ============================================================

-- 1. normalize_guest_appointment — drop the deposit computation + deposit_required raise.
CREATE OR REPLACE FUNCTION public.normalize_guest_appointment()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_require_approval boolean;
  v_duration         int;
BEGIN
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  SELECT s.duration_minutes INTO v_duration
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

  SELECT o.require_approval INTO v_require_approval
    FROM organisations o WHERE o.id = NEW.org_id;

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

-- 2. get_manage_context — drop deposit_refundable; refund now gated by window only.
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
    'can_manage',                (a.status IN ('pending', 'approved') AND a.scheduled_at > now()),
    'refund_on_cancel',          (
       a.status IN ('pending', 'approved') AND a.scheduled_at > now()
       AND a.payment_status = 'paid' AND a.payment_reference IS NOT NULL
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

-- 3. get_org_analytics — drop the deposit-derived deposits_collected metric.
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
    SELECT a.status, a.customer_id, a.staff_id, s.price,
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

-- 4. Billing counters — drop the dead 'deposit_paid' status literal (it is a
--    payment_status value, never an appointment status, so this is a no-op tidy).
CREATE OR REPLACE FUNCTION public.get_org_billing_status(p_org_id uuid)
  RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_result jsonb; v_period_start timestamptz; v_price numeric(10,2); v_count int; v_rolled numeric(10,2);
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT current_period_start(o.usage_anchor), (pc.billing_config ->> 'appointment_price')::numeric
    INTO v_period_start, v_price
    FROM organisations o CROSS JOIN platform_config pc WHERE o.id = p_org_id AND pc.id = 1;
  SELECT count(*)::int INTO v_count FROM appointments a
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
           'running_amount', round(v_count * v_price, 2), 'rolled_forward', v_rolled,
           'card', (SELECT jsonb_build_object('last4', pm.last4, 'brand', pm.brand, 'expires_at', pm.expires_at)
                      FROM org_payment_methods pm
                     WHERE pm.org_id = o.id AND pm.is_default AND pm.status = 'active' LIMIT 1))
    INTO v_result FROM organisations o WHERE o.id = p_org_id;
  RETURN v_result;
END; $function$;

-- close_billing_period_for_org: same dead-literal tidy (rest unchanged from 20260803120000).
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
  ON CONFLICT (org_id, period_start) DO NOTHING
  RETURNING id INTO v_bp_id;
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
END;
$function$;

-- 5. get_public_org — drop deposit_type/deposit_value/deposit_refundable (return
--    signature changes → DROP + CREATE). Keeps cancellation_window_hours.
DROP FUNCTION IF EXISTS public.get_public_org(text);
CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, cancellation_window_hours integer, contact_email text, require_approval boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT
    o.id, o.name::text, o.description, o.contact_phone, o.address, o.logo_url,
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
    o.contact_email, o.require_approval
  FROM organisations o WHERE o.slug = p_slug;
$function$;

-- 6. Migrate existing partial-deposit rows to fully paid, then drop the enum value.
UPDATE appointments SET payment_status = 'paid' WHERE payment_status = 'deposit_paid';
ALTER TABLE appointments DROP CONSTRAINT appointments_payment_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_payment_status_check
  CHECK (payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'refunded'::text]));

-- 7. Drop the deposit columns.
ALTER TABLE organisations DROP COLUMN IF EXISTS deposit_type,
                          DROP COLUMN IF EXISTS deposit_value,
                          DROP COLUMN IF EXISTS deposit_refundable;
ALTER TABLE services DROP COLUMN IF EXISTS deposit_type,
                     DROP COLUMN IF EXISTS deposit_value;
ALTER TABLE pending_bookings DROP COLUMN IF EXISTS is_deposit;
