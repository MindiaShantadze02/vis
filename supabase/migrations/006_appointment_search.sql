-- ============================================================
-- 006_appointment_search.sql
-- Run AFTER 005_staff_and_capacity.sql.
-- Moves the dashboard appointments search from the client to the
-- database. The Overview page previously fetched the latest 100
-- rows and filtered them in-memory by customer/service text. That
-- both missed older matches and shipped unnecessary rows. This RPC
-- pushes the status + text filter into Postgres.
--
-- The search spans two related tables (customers OR services) with
-- OR logic, which PostgREST embedding cannot express in a single
-- query — hence an RPC rather than a richer .select() filter.
-- ============================================================


-- ============================================================
-- TRIGRAM INDEXES
-- Speed up the ILIKE '%term%' substring matches below. Without
-- pg_trgm these would be sequential scans; gin_trgm_ops makes
-- them index-assisted.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_customers_first_name_trgm ON customers USING gin (first_name gin_trgm_ops);
CREATE INDEX idx_customers_last_name_trgm  ON customers USING gin (last_name gin_trgm_ops);
CREATE INDEX idx_customers_phone_trgm      ON customers USING gin (phone_number gin_trgm_ops);
CREATE INDEX idx_services_name_trgm        ON services  USING gin (name gin_trgm_ops);


-- ============================================================
-- SEARCH FUNCTION
-- SECURITY INVOKER (default): runs as the caller so existing RLS
-- on appointments/customers/services applies. Passing a foreign
-- p_org_id the caller doesn't belong to simply returns no rows.
--
-- Relations are returned as jsonb so the client receives the same
-- nested shape as the previous PostgREST embed (customers,
-- services, staff objects).
-- ============================================================
CREATE OR REPLACE FUNCTION search_appointments(
  p_org_id uuid,
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 100
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
  staff            jsonb
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
    ) END AS staff
  FROM appointments a
  LEFT JOIN customers   c ON c.id = a.customer_id
  LEFT JOIN services    s ON s.id = a.service_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.org_id = p_org_id
    AND (p_status IS NULL OR a.status = p_status)
    AND (
      p_search IS NULL OR p_search = '' OR
      c.first_name   ILIKE '%' || p_search || '%' OR
      c.last_name    ILIKE '%' || p_search || '%' OR
      c.phone_number ILIKE '%' || p_search || '%' OR
      s.name         ILIKE '%' || p_search || '%'
    )
  ORDER BY a.scheduled_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_appointments IS
  'Dashboard appointments list with server-side status + text search '
  '(customer name/phone or service name). Runs SECURITY INVOKER so RLS applies.';
