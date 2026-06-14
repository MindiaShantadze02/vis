-- ============================================================
-- 005_staff_and_capacity.sql
-- Run AFTER 004_rls.sql.
-- Adds two capabilities:
--   1. Per-service max-appointments-per-slot capacity.
--   2. Assignable people (bookable team members) per service,
--      with per-person availability during booking.
--
-- NOTE: the LIVE booking flow is client-side and now uses
-- services.max_per_slot for capacity. working_hours_template.
-- max_appointments_per_slot and the get_available_slots() SQL
-- function are legacy/superseded and intentionally left unchanged
-- (only referenced by the unused get-available-slots Edge Function).
-- ============================================================


-- ============================================================
-- SERVICES: per-service slot capacity
-- ============================================================
ALTER TABLE services
  ADD COLUMN max_per_slot int2 NOT NULL DEFAULT 1 CHECK (max_per_slot > 0);

COMMENT ON COLUMN services.max_per_slot IS
  'Max concurrent appointments allowed for this service in a single time slot.';


-- ============================================================
-- ORG_MEMBERS: bookable staff identity
-- Members are reused as assignable people (barbers/instructors).
-- They need a display name and an opt-in bookable flag so they
-- can be shown to customers on the public booking page.
-- ============================================================
ALTER TABLE org_members
  ADD COLUMN display_name text,
  ADD COLUMN title        text,
  ADD COLUMN is_bookable  boolean NOT NULL DEFAULT false,
  ADD COLUMN sort_order   int2 NOT NULL DEFAULT 0;

COMMENT ON COLUMN org_members.is_bookable IS
  'When true, this member can be assigned to services and picked by customers during booking.';


-- ============================================================
-- SERVICE_STAFF: which members can perform which service
-- org_id is denormalized so RLS write policies can use the
-- standard org_id = ANY(get_user_org_ids()) convention.
-- ============================================================
CREATE TABLE service_staff (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES org_members(id) ON DELETE CASCADE,
  UNIQUE (service_id, member_id)
);

COMMENT ON TABLE service_staff IS
  'Maps services to the org members who can perform them (bookable staff).';


-- ============================================================
-- APPOINTMENTS: assigned person
-- ON DELETE SET NULL — removing a member must not delete history,
-- it just unassigns the appointment.
-- ============================================================
ALTER TABLE appointments
  ADD COLUMN staff_id uuid REFERENCES org_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN appointments.staff_id IS
  'The org member assigned to perform this appointment, if any.';


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_appointments_staff_scheduled ON appointments(staff_id, scheduled_at);
CREATE INDEX idx_service_staff_service        ON service_staff(service_id);
CREATE INDEX idx_service_staff_member         ON service_staff(member_id);


-- ============================================================
-- RLS — SERVICE_STAFF
-- Public SELECT: the unauthenticated booking page reads the
-- service -> member mapping. Rows are UUID-only (no PII).
-- ============================================================
ALTER TABLE service_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_staff_public_select"
  ON service_staff FOR SELECT
  USING (true);

CREATE POLICY "service_staff_member_insert"
  ON service_staff FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "service_staff_member_update"
  ON service_staff FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

CREATE POLICY "service_staff_member_delete"
  ON service_staff FOR DELETE
  USING (org_id = ANY(get_user_org_ids()));


-- ============================================================
-- RLS — ORG_MEMBERS additions
-- ============================================================
-- (1) Allow the unauthenticated booking page to read bookable
-- members so it can show staff names. Permissive policies are
-- OR-combined with the existing org-scoped org_members_select.
-- Tradeoff: this widens row visibility (incl. user_id/role) for
-- is_bookable members; user_id is an opaque UUID for people the
-- business intentionally publishes as staff. If column-level
-- restriction is later required, replace this with a SECURITY
-- DEFINER RPC returning only id/display_name/title.
CREATE POLICY "org_members_public_bookable_select"
  ON org_members FOR SELECT
  USING (is_bookable = true);

-- (2) No UPDATE policy existed before. Members manage their own
-- org's member rows (display_name/title/is_bookable/sort_order).
CREATE POLICY "org_members_member_update"
  ON org_members FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));
