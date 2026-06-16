-- ============================================================
-- 007_appointment_search_pagination.sql
-- Run AFTER 006_appointment_search.sql.
--
-- Extends search_appointments with:
--   * date-range filter on scheduled_at (p_date_from / p_date_to)
--   * server-side pagination (p_offset, existing p_limit)
--   * total_count via count(*) OVER() so a single round-trip
--     returns both the page rows and the grand total that the
--     dashboard's TablePagination control needs.
--
-- CREATE OR REPLACE cannot alter a function's RETURNS TABLE
-- signature ("cannot change return type of existing function"),
-- so the old 4-arg signature is dropped first, then recreated.
-- Still SECURITY INVOKER (default) so RLS applies unchanged.
-- ============================================================

DROP FUNCTION IF EXISTS search_appointments(uuid, text, text, int);

CREATE FUNCTION search_appointments(
  p_org_id    uuid,
  p_status    text        DEFAULT NULL,
  p_search    text        DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to   timestamptz DEFAULT NULL,
  p_limit     int         DEFAULT 100,
  p_offset    int         DEFAULT 0
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
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name',   c.first_name,
      'last_name',    c.last_name,
      'phone_number', c.phone_number
    ) END AS customers,
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name',             s.name,
      'price',            s.price,
      'duration_minutes', s.duration_minutes
    ) END AS services,
    CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',           m.id,
      'display_name', m.display_name,
      'title',        m.title
    ) END AS staff,
    -- Full filtered total (computed before LIMIT/OFFSET), identical
    -- on every row; the client reads it off the first row.
    count(*) OVER() AS total_count
  FROM appointments a
  LEFT JOIN customers   c ON c.id = a.customer_id
  LEFT JOIN services    s ON s.id = a.service_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.org_id = p_org_id
    AND (p_status    IS NULL OR a.status = p_status)
    AND (p_date_from IS NULL OR a.scheduled_at >= p_date_from)
    AND (p_date_to   IS NULL OR a.scheduled_at <= p_date_to)
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
  'Dashboard appointments list: server-side status + text + date-range '
  'filter with pagination (offset/limit) and total_count via count(*) OVER(). '
  'Runs SECURITY INVOKER so RLS applies.';
