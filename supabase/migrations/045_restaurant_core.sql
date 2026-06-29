-- ============================================================
-- 045_restaurant_core.sql
-- Run AFTER 044_org_vertical.sql.
--
-- Phase 2 (restaurants) data model. PURELY ADDITIVE — creates new tables
-- only; no existing table/column/trigger/policy is touched, so the live
-- appointments flow is unaffected. These tables are only ever read/written
-- when an org's vertical = 'restaurant'.
--
--   resources               generic bookable inventory beyond staff
--                           (restaurant tables now; hotel room_types later).
--                           Staff stay in org_members as before.
--   restaurant_reservations a table booking: party_size + arrival time +
--                           turn time, with restaurant-specific statuses
--                           (adds 'no_show' on top of the appointment set).
--
-- Availability for restaurants is party-size -> table-capacity matching over
-- covers/turn-time; that logic lives in application/edge code, not here.
-- Deposits/prepayment are deferred to a later migration (see PLAN.md §2.4).
-- ============================================================


-- ============================================================
-- RESOURCES — generic bookable inventory (tables, later room_types)
-- ============================================================
CREATE TABLE resources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('table','room_type')),
  name       text NOT NULL,
  capacity   int2 NOT NULL DEFAULT 1 CHECK (capacity > 0),
  attrs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int2 NOT NULL DEFAULT 0,
  is_active  bool NOT NULL DEFAULT true
);

COMMENT ON TABLE resources IS
  'Generic bookable inventory beyond staff. kind=table for restaurants '
  '(capacity = seats); kind=room_type reserved for hotels. Staff remain in '
  'org_members. Only used by orgs whose vertical is restaurant/hotel.';

CREATE INDEX idx_resources_org_kind ON resources(org_id, kind);


-- ============================================================
-- RESTAURANT_RESERVATIONS — a table booking
-- ============================================================
CREATE TABLE restaurant_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  org_id       uuid NOT NULL REFERENCES organisations(id),
  customer_id  uuid NOT NULL REFERENCES customers(id),
  -- Assigned table (optional: a reservation can be accepted before seating is
  -- decided). SET NULL so removing a table never deletes booking history.
  table_id     uuid REFERENCES resources(id) ON DELETE SET NULL,
  party_size   int2 NOT NULL CHECK (party_size > 0),
  reserved_at  timestamptz NOT NULL,
  -- How long the table is held; availability subtracts this turn window.
  turn_minutes int2 NOT NULL DEFAULT 120 CHECK (turn_minutes > 0),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','cancelled','completed','no_show')),
  notes        text,
  admin_notes  text
);

COMMENT ON TABLE restaurant_reservations IS
  'Restaurant table booking. Mirrors appointments structurally (one party, one '
  'arrival time) but with party_size + turn_minutes for covers/table matching '
  'and a no_show status. The appointments table is left untouched.';

CREATE INDEX idx_reservations_org_reserved ON restaurant_reservations(org_id, reserved_at);
CREATE INDEX idx_reservations_status       ON restaurant_reservations(status);
CREATE INDEX idx_reservations_table        ON restaurant_reservations(table_id);

-- Reuse the existing updated_at stamper (defined in 002_functions.sql).
CREATE TRIGGER restaurant_reservations_updated_at
  BEFORE UPDATE ON restaurant_reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- RLS — RESOURCES (mirrors services: public read, member write, owner delete)
-- ============================================================
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resources_public_select"
  ON resources FOR SELECT
  USING (true);

CREATE POLICY "resources_member_insert"
  ON resources FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "resources_member_update"
  ON resources FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

CREATE POLICY "resources_owner_delete"
  ON resources FOR DELETE
  USING (get_user_org_role(org_id) = 'owner' OR is_superadmin());


-- ============================================================
-- RLS — RESTAURANT_RESERVATIONS (mirrors appointments:
-- public select via unguessable UUID, public guest insert, member update)
-- ============================================================
ALTER TABLE restaurant_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reservations_select"
  ON restaurant_reservations FOR SELECT
  USING (true);

CREATE POLICY "reservations_public_insert"
  ON restaurant_reservations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "reservations_member_update"
  ON restaurant_reservations FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));
