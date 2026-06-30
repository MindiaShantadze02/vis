-- ============================================================
-- 048_hotel_core.sql
-- Run AFTER 047_reservation_otp_guard.sql.
--
-- Phase 3 (hotels) data model. PURELY ADDITIVE — new table only; nothing
-- existing is touched. Used only when an org's vertical = 'hotel'.
--
-- The big departure from appointments/restaurants: a stay is a multi-night
-- DATE RANGE (check_in → check_out), not a single instant. We store native
-- `date` columns so there is no contortion of the appointment schema.
--
-- Room TYPES reuse the generic `resources` table (kind='room_type', added in
-- 045): capacity = max guests per room; the nightly price and how many such
-- rooms exist live in resources.attrs ({nightly_price, total_rooms}). Per-night
-- availability is computed in app code by counting overlapping stays of the
-- room type against total_rooms (no separate inventory-calendar table for the
-- MVP — room-type granularity, per open question #2).
-- ============================================================

CREATE TABLE hotel_stays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  org_id       uuid NOT NULL REFERENCES organisations(id),
  customer_id  uuid NOT NULL REFERENCES customers(id),
  -- The booked room type. SET NULL so removing a room type keeps stay history.
  room_type_id uuid REFERENCES resources(id) ON DELETE SET NULL,
  check_in     date NOT NULL,
  check_out    date NOT NULL,
  guests       int2 NOT NULL DEFAULT 1 CHECK (guests > 0),
  -- Snapshotted at booking time so later price edits don't rewrite history.
  nightly_rate numeric(10,2) NOT NULL DEFAULT 0,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','cancelled','checked_in','checked_out','no_show')),
  notes        text,
  admin_notes  text,
  -- A stay must be at least one night.
  CONSTRAINT hotel_stays_range_chk CHECK (check_out > check_in)
);

COMMENT ON TABLE hotel_stays IS
  'A hotel booking over a date range (check_in..check_out). Room TYPE lives in '
  'resources(kind=room_type); nightly_rate/total_amount are snapshotted at '
  'booking. The appointments table is untouched.';

CREATE INDEX idx_hotel_stays_org_dates ON hotel_stays(org_id, check_in, check_out);
CREATE INDEX idx_hotel_stays_status    ON hotel_stays(status);
CREATE INDEX idx_hotel_stays_room_type ON hotel_stays(room_type_id);

-- Reuse the shared updated_at stamper (002) and the OTP gate (030): the latter
-- keys off NEW.org_id/NEW.customer_id, both present here, and exempts admins.
CREATE TRIGGER hotel_stays_updated_at
  BEFORE UPDATE ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_enforce_stay_verification
  BEFORE INSERT ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_verification();

-- ============================================================
-- RLS — mirrors appointments/restaurant_reservations:
-- public select (unguessable UUID), public guest insert, member update.
-- ============================================================
ALTER TABLE hotel_stays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hotel_stays_select"
  ON hotel_stays FOR SELECT
  USING (true);

CREATE POLICY "hotel_stays_public_insert"
  ON hotel_stays FOR INSERT
  WITH CHECK (true);

CREATE POLICY "hotel_stays_member_update"
  ON hotel_stays FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));
