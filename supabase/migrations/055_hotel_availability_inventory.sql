-- ============================================================
-- 055_hotel_availability_inventory.sql
-- Run AFTER 054_catalog_images.sql.
--
-- Hardens the hotel booking mechanics:
--   1. room_inventory_overrides — owner per-date inventory control (block a date
--      or reduce available rooms because of off-platform bookings / maintenance).
--   2. get_room_availability(org, check_in, check_out) — SECURITY DEFINER RPC the
--      anon booking page calls to get per-room-type availability WITHOUT reading
--      other guests' stay rows. Replaces the client-side query of hotel_stays.
--   3. Tighten hotel_stays SELECT — previously `USING (true)` exposed every stay
--      (dates, notes, amounts) of every org to anon. Now member/superadmin only.
--   4. enforce_hotel_inventory — BEFORE INSERT trigger that rejects a stay which
--      would push any night over the room type's inventory. Authoritative guard
--      for BOTH the pay-at-desk direct insert and the online payment-webhook
--      promotion; closes the "two guests book the last room" race.
--   5. organisations.check_in_time / check_out_time — property times (hotels use
--      these instead of the hourly working_hours model).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Owner per-date inventory control.
-- `working_hours_overrides` is appointment-shaped (open/closed + hourly ranges),
-- a poor fit here, so hotels get a dedicated table. `rooms_available` is the
-- ABSOLUTE number of rooms of this type bookable on this date (0 = blocked); it
-- overrides attrs.total_rooms for that date only.
-- ------------------------------------------------------------
CREATE TABLE room_inventory_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  org_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  room_type_id   uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  date           date NOT NULL,
  rooms_available int NOT NULL CHECK (rooms_available >= 0),
  note           text,
  UNIQUE (room_type_id, date)
);

CREATE INDEX idx_room_inventory_overrides_lookup
  ON room_inventory_overrides(room_type_id, date);

COMMENT ON TABLE room_inventory_overrides IS
  'Per-date absolute room count for a room type (0 = blocked). Overrides '
  'attrs.total_rooms for that date; read by get_room_availability and the '
  'enforce_hotel_inventory trigger.';

ALTER TABLE room_inventory_overrides ENABLE ROW LEVEL SECURITY;

-- Members manage their own org's overrides. Anon never reads this directly —
-- availability flows through the SECURITY DEFINER RPC below.
CREATE POLICY "room_inventory_member_select"
  ON room_inventory_overrides FOR SELECT
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

CREATE POLICY "room_inventory_member_insert"
  ON room_inventory_overrides FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "room_inventory_member_update"
  ON room_inventory_overrides FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

CREATE POLICY "room_inventory_member_delete"
  ON room_inventory_overrides FOR DELETE
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

-- ------------------------------------------------------------
-- 2. Availability RPC. Returns one row per active room type with `remaining` =
-- the minimum free rooms across every night in [check_in, check_out). The anon
-- booking page filters by capacity >= party size and remaining > 0. SECURITY
-- DEFINER so it can count stays without exposing stay rows (same trust model as
-- get_public_org). A stay [s,e) occupies night N when s <= N < e.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_room_availability(
  p_org_id   uuid,
  p_check_in date,
  p_check_out date
)
RETURNS TABLE (
  room_type_id  uuid,
  name          text,
  description   text,
  capacity      int2,
  nightly_price numeric,
  total_rooms   int,
  remaining     int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH nights AS (
    SELECT g::date AS night
    FROM generate_series(p_check_in::timestamp, (p_check_out - 1)::timestamp, interval '1 day') AS g
  ),
  rt AS (
    SELECT r.id, r.name::text AS name, r.attrs->>'description' AS description, r.capacity,
           COALESCE((r.attrs->>'nightly_price')::numeric, 0) AS nightly_price,
           COALESCE((r.attrs->>'total_rooms')::int, 0)       AS total_rooms
    FROM resources r
    WHERE r.org_id = p_org_id AND r.kind = 'room_type' AND r.is_active = true
  ),
  per_night AS (
    SELECT rt.id AS room_type_id,
           COALESCE(o.rooms_available, rt.total_rooms) AS cap_for_night,
           (SELECT count(*) FROM hotel_stays s
             WHERE s.room_type_id = rt.id
               AND s.status NOT IN ('rejected','cancelled','no_show')
               AND s.check_in <= n.night AND n.night < s.check_out) AS occupied
    FROM rt CROSS JOIN nights n
    LEFT JOIN room_inventory_overrides o
      ON o.room_type_id = rt.id AND o.date = n.night
  )
  SELECT rt.id, rt.name, rt.description, rt.capacity, rt.nightly_price, rt.total_rooms,
         COALESCE(MIN(pn.cap_for_night - pn.occupied), rt.total_rooms)::int AS remaining
  FROM rt
  LEFT JOIN per_night pn ON pn.room_type_id = rt.id
  GROUP BY rt.id, rt.name, rt.description, rt.capacity, rt.nightly_price, rt.total_rooms;
$$;

REVOKE ALL ON FUNCTION public.get_room_availability(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_availability(uuid, date, date) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Close the anon stay-read leak. Members/superadmin only; the anon booking
-- page now gets availability solely through get_room_availability.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "hotel_stays_select" ON hotel_stays;
CREATE POLICY "hotel_stays_select"
  ON hotel_stays FOR SELECT
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

-- ------------------------------------------------------------
-- 4. Write-time overbooking guard. Rejects an insert that would exceed the room
-- type's inventory on any night of its range, honoring per-date overrides. Fires
-- for BOTH booking paths (direct pay-at-desk insert and webhook promotion).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_hotel_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total         int;
  v_min_remaining int;
BEGIN
  IF NEW.room_type_id IS NULL THEN
    RETURN NEW;  -- no inventory to enforce against
  END IF;

  SELECT COALESCE((attrs->>'total_rooms')::int, 0) INTO v_total
    FROM resources WHERE id = NEW.room_type_id;

  -- Minimum free rooms across the nights this stay would occupy, counting
  -- existing non-cancelled stays of the same type and honoring overrides.
  SELECT MIN(cap_for_night - occupied) INTO v_min_remaining
  FROM (
    SELECT COALESCE(o.rooms_available, v_total) AS cap_for_night,
           (SELECT count(*) FROM hotel_stays s
             WHERE s.room_type_id = NEW.room_type_id
               AND s.id <> NEW.id
               AND s.status NOT IN ('rejected','cancelled','no_show')
               AND s.check_in <= g.night AND g.night < s.check_out) AS occupied
    FROM (
      SELECT d::date AS night
      FROM generate_series(NEW.check_in::timestamp, (NEW.check_out - 1)::timestamp, interval '1 day') AS d
    ) g
    LEFT JOIN room_inventory_overrides o
      ON o.room_type_id = NEW.room_type_id AND o.date = g.night
  ) per_night;

  -- This stay consumes one room on every night; require at least one free.
  IF COALESCE(v_min_remaining, 1) < 1 THEN
    RAISE EXCEPTION 'room_unavailable'
      USING HINT = 'room type is fully booked for one or more nights in the range';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_hotel_inventory IS
  'BEFORE INSERT guard on hotel_stays: rejects a stay that would push any night '
  'over the room type inventory (attrs.total_rooms minus per-date overrides). '
  'Raises room_unavailable. Runs before enforce_stay_verification / enforce_stay_limit.';

-- Name prefix keeps it ahead of the OTP + limit triggers alphabetically so the
-- cheap inventory check short-circuits first.
DROP TRIGGER IF EXISTS trg_enforce_hotel_inventory ON hotel_stays;
CREATE TRIGGER trg_enforce_hotel_inventory
  BEFORE INSERT ON hotel_stays
  FOR EACH ROW EXECUTE FUNCTION enforce_hotel_inventory();

-- ------------------------------------------------------------
-- 5. Property check-in / check-out times (hotels). Nullable; shown read-only on
-- the booking page. Extend get_public_org so the anon page can read them.
-- ------------------------------------------------------------
ALTER TABLE organisations
  ADD COLUMN check_in_time  time,
  ADD COLUMN check_out_time time;

COMMENT ON COLUMN organisations.check_in_time IS
  'Hotel property check-in time (nullable). Hotels reason about availability per '
  'night, not hourly slots, so this replaces the working_hours model for them.';

DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
RETURNS TABLE (
  id                       uuid,
  name                     text,
  description              text,
  contact_phone            text,
  logo_url                 text,
  slug                     text,
  booking_theme            text,
  vertical                 text,
  reservation_turn_minutes int2,
  check_in_time            time,
  check_out_time           time,
  payment_methods          jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.name::text,
    o.description,
    o.contact_phone,
    o.logo_url,
    o.slug::text,
    o.booking_theme,
    o.vertical,
    o.reservation_turn_minutes,
    o.check_in_time,
    o.check_out_time,
    COALESCE(
      (
        SELECT jsonb_object_agg(
                 key,
                 jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false))
               )
        FROM jsonb_each(o.payment_config)
      ),
      '{}'::jsonb
    ) AS payment_methods
  FROM organisations o
  WHERE o.slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;
