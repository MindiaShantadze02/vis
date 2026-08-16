-- ============================================================
-- 20260814120000_remove_pending_status.sql
--
-- Removes the pending-approval workflow. Every appointment is now created
-- 'approved'; there is no approval queue and no owner-side approve/reject.
--
-- Why it is already dead in practice:
--   * 20260812120000_min_service_price removed the free-service path, so every
--     public booking is fulfilled by payment-webhook, which hard-codes
--     status='approved'. A booking made through the booking page has not been
--     able to land 'pending' since.
--   * The owner-side manual entry that could create/approve one was removed
--     with the add-appointment dialog.
--   * That left two producers: api_create_booking (the public REST API, which
--     still honoured organisations.require_approval and an explicit
--     status:'pending') and a raw anon PostgREST insert through
--     normalize_guest_appointment. Both are closed below.
--
-- BREAKING for the public REST API: POST /v1/bookings no longer accepts a
-- `status` field (the `api` edge function returns 422 for it), and
-- api_create_booking loses its p_status parameter.
--
-- Existing 'pending' rows are PROMOTED to 'approved', not deleted — they are
-- real bookings a customer made, and with no approval UI left there is nothing
-- that could ever action them.
-- ============================================================

-- --------------------------------------------------------
-- 1. Backfill first, so the narrowed CHECKs validate immediately.
-- --------------------------------------------------------
UPDATE appointments   SET status = 'approved'        WHERE status = 'pending';
UPDATE notifications  SET type   = 'new_appointment' WHERE type   = 'pending_approval';

-- Same treatment for the hotel/restaurant notification types: their subject
-- tables went with 059_appointments_only, so any surviving row is orphaned.
DELETE FROM notifications WHERE type IN ('new_reservation', 'new_stay');

-- --------------------------------------------------------
-- 2. Narrow the status vocabularies.
--    appointments_status_check was last set in 089_deposits.
--    notifications' type CHECK was last set in 20260724160000_billing_advance_notice
--    (whose ARRAY still carried the retired 'new_reservation'/'new_stay' from the
--    removed hotel/restaurant verticals — dropped here too).
-- --------------------------------------------------------
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('approved', 'rejected', 'cancelled', 'completed', 'no_show'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_appointment', 'appointment_cancelled', 'billing_notice'));

-- --------------------------------------------------------
-- 3. normalize_guest_appointment — same body as 20260806120000_readd_deposits
--    minus the require_approval lookup; the guest status is now a constant.
--    Every other pinned field and the deposit guard are unchanged.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_guest_appointment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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

  SELECT o.deposit_type, o.deposit_value
    INTO v_o_dtype, v_o_dval
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

  NEW.status            := 'approved';
  NEW.payment_status    := 'unpaid';
  NEW.payment_method    := 'in_person';
  NEW.payment_provider  := NULL;
  NEW.payment_reference := NULL;
  NEW.admin_notes       := NULL;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION normalize_guest_appointment IS
  'BEFORE INSERT on appointments: pins status/payment_*/admin_notes to safe '
  'defaults for untrusted (guest) inserts and raises deposit_required when the '
  'service/org owes a deposit. Status is always ''approved'' since the '
  'pending-approval workflow was removed (20260814120000). Exempts the service '
  'role (webhook), superadmins, and members of the target org. Closes the guest '
  'field-tampering path from the appointments_public_insert WITH CHECK(true) '
  'policy (069 audit #1).';

-- --------------------------------------------------------
-- 4. notify_new_appointment — supersedes 021. Only the type/title CASEs change.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_new_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name text;
  v_service_name  text;
BEGIN
  -- Skip only when an admin of THIS org created the appointment themselves.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id
      AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
    INTO v_customer_name
    FROM customers c
   WHERE c.id = NEW.customer_id;

  SELECT s.name
    INTO v_service_name
    FROM services s
   WHERE s.id = NEW.service_id;

  -- A failure here must never roll back the booking itself.
  BEGIN
    INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
    SELECT
      NEW.org_id,
      m.user_id,
      'new_appointment',
      NEW.id,
      'ახალი ჯავშანი',
      concat_ws(' · ', v_customer_name, v_service_name)
    FROM org_members m
    WHERE m.org_id = NEW.org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_new_appointment failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- --------------------------------------------------------
-- 5. api_create_booking — supersedes 075. Dropping p_status changes the
--    signature, so DROP + CREATE (CREATE OR REPLACE would leave an overload).
--    Everything else (GUC, validation, pinned payment fields) is unchanged.
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS api_create_booking(uuid, uuid, text, text, text, timestamptz, uuid, text, text, text);

CREATE FUNCTION api_create_booking(
  p_org_id          uuid,
  p_service_id      uuid,
  p_first_name      text,
  p_last_name       text,
  p_phone           text,
  p_scheduled_at    timestamptz,
  p_staff_id        uuid DEFAULT NULL,
  p_notes           text DEFAULT NULL,
  p_consent_version text DEFAULT NULL
)
RETURNS TABLE (appointment_id uuid, status text, scheduled_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration    int;
  v_customer_id uuid;
  v_appt_id     uuid;
BEGIN
  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = p_service_id
       AND ss.member_id = p_staff_id
       AND m.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  -- Transaction-local: read by enforce_booking_verification (see 071).
  PERFORM set_config('app.api_booking', '1', true);

  INSERT INTO customers (first_name, last_name, phone_number,
                         consent_accepted_at, consent_version)
  VALUES (p_first_name, nullif(trim(coalesce(p_last_name, '')), ''), p_phone,
          now(), p_consent_version)
  RETURNING customers.id INTO v_customer_id;

  INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at,
                            duration_minutes, staff_id, status,
                            payment_method, payment_status,
                            payment_provider, payment_reference,
                            notes, admin_notes)
  VALUES (p_org_id, p_service_id, v_customer_id, p_scheduled_at,
          v_duration, p_staff_id, 'approved',
          'in_person', 'unpaid',
          NULL, NULL,
          nullif(trim(coalesce(p_notes, '')), ''), NULL)
  RETURNING appointments.id INTO v_appt_id;

  RETURN QUERY SELECT v_appt_id, 'approved'::text, p_scheduled_at;
END;
$$;

COMMENT ON FUNCTION api_create_booking IS
  'Public-API booking writer: validates service/staff, sets the app.api_booking '
  'GUC (OTP exemption), inserts customer + appointment with pinned payment '
  'fields. Always creates ''approved'' — the p_status parameter and the '
  'require_approval workflow were removed (20260814120000). Advance-window / '
  'SMS triggers still apply. Raises service_not_found | staff_not_available '
  '(plus trigger error booking_too_far_in_advance). Service-role only.';

REVOKE EXECUTE ON FUNCTION api_create_booking(uuid, uuid, text, text, text, timestamptz, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------
-- 6. search_appointments — supersedes 20260718090437. Signature unchanged, so
--    CREATE OR REPLACE; only the pending-first ORDER BY term goes.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION search_appointments(
  p_org_id         uuid,
  p_status         text        DEFAULT NULL,
  p_search         text        DEFAULT NULL,
  p_date_from      timestamptz DEFAULT NULL,
  p_date_to        timestamptz DEFAULT NULL,
  p_service_id     uuid        DEFAULT NULL,
  p_staff_id       uuid        DEFAULT NULL,
  p_payment_status text        DEFAULT NULL,
  p_limit          int         DEFAULT 100,
  p_offset         int         DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  scheduled_at     timestamptz,
  duration_minutes int2,
  service_id       uuid,
  staff_id         uuid,
  status           text,
  payment_method   text,
  payment_status   text,
  notes            text,
  admin_notes      text,
  meeting_link     text,
  customers        jsonb,
  services         jsonb,
  staff            jsonb,
  total_count      bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    a.scheduled_at,
    a.duration_minutes,
    a.service_id,
    a.staff_id,
    a.status,
    a.payment_method,
    a.payment_status,
    a.notes,
    a.admin_notes,
    a.meeting_link,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name',   c.first_name,
      'last_name',    c.last_name,
      'phone_number', c.phone_number
    ) END AS customers,
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name',             s.name,
      'price',            s.price,
      'duration_minutes', s.duration_minutes,
      'location_type',    s.location_type
    ) END AS services,
    CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',           m.id,
      'display_name', m.display_name,
      'title',        m.title
    ) END AS staff,
    count(*) OVER() AS total_count
  FROM appointments a
  LEFT JOIN customers   c ON c.id = a.customer_id
  LEFT JOIN services    s ON s.id = a.service_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.org_id = p_org_id
    AND (p_status         IS NULL OR a.status = p_status)
    AND (p_service_id     IS NULL OR a.service_id = p_service_id)
    AND (p_staff_id       IS NULL OR a.staff_id = p_staff_id)
    AND (p_payment_status IS NULL OR a.payment_status = p_payment_status)
    AND (p_date_from      IS NULL OR a.scheduled_at >= p_date_from)
    AND (p_date_to        IS NULL OR a.scheduled_at <= p_date_to)
    AND (
      p_search IS NULL OR p_search = '' OR
      c.first_name   ILIKE '%' || p_search || '%' OR
      c.last_name    ILIKE '%' || p_search || '%' OR
      c.phone_number ILIKE '%' || p_search || '%' OR
      s.name         ILIKE '%' || p_search || '%'
    )
  ORDER BY a.scheduled_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION search_appointments IS
  'Dashboard appointments list: server-side status + text + date-range + '
  'service + staff + payment-status filter with pagination (offset/limit) and '
  'total_count via count(*) OVER(). Returns per-appointment meeting_link and '
  'the service location_type. Orders newest scheduled first (the pending-first '
  'term went with the approval queue, 20260814120000). Runs SECURITY INVOKER '
  'so RLS applies.';

-- --------------------------------------------------------
-- 7. create_guest_booking — retired and revoked by 20260812120000, and its
--    hard-coded 'pending' INSERT would now violate the CHECK above. Drop it.
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS create_guest_booking(uuid, uuid, timestamptz, text, text, text, text, uuid, boolean, text);

-- --------------------------------------------------------
-- 8. organisations.require_approval — now unreadable by anything. Dropping the
--    column forces get_public_org (which returns it) to be recreated; its
--    return signature changes, so DROP + CREATE. Nothing in the client reads
--    require_approval, so no caller breaks.
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_org(text);
CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, cover_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, cancellation_window_hours integer, contact_email text, deposit_type text, deposit_value numeric, deposit_refundable boolean)
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
    o.contact_email,
    o.deposit_type, o.deposit_value, o.deposit_refundable
  FROM organisations o WHERE o.slug = p_slug;
$function$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;

ALTER TABLE organisations DROP COLUMN IF EXISTS require_approval;
