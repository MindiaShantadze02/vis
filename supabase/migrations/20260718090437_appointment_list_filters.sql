-- ============================================================
-- appointment_list_filters
-- Run AFTER 20260717190446_analytics.
--
-- Adds three optional filters to the dashboard appointments list
-- (search_appointments): by service, by assigned professional, and by
-- payment status. The RETURNS TABLE shape is unchanged — only input params
-- are added — but Postgres still can't add params to an existing function via
-- CREATE OR REPLACE without risking an overload, so we DROP the prior
-- signature (082) and recreate. The dashboard calls it over PostgREST with
-- named params; no other caller exists.
-- ============================================================

DROP FUNCTION IF EXISTS search_appointments(uuid, text, text, timestamptz, timestamptz, int, int);

CREATE FUNCTION search_appointments(
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
  ORDER BY (a.status = 'pending') DESC, a.scheduled_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION search_appointments IS
  'Dashboard appointments list: server-side status + text + date-range + '
  'service + staff + payment-status filter with pagination (offset/limit) and '
  'total_count via count(*) OVER(). Returns per-appointment meeting_link and '
  'the service location_type. Orders pending (action-needed) first, then newest '
  'scheduled. Runs SECURITY INVOKER so RLS applies.';
