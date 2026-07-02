-- ============================================================
-- 058_hotel_cancellation.sql
-- Run AFTER 057_resource_image_limit.sql.
--
-- Guest self-service cancellation for hotel stays (hotels especially need a
-- stated free-cancel window). Appointments have no self-service cancel, so this
-- is net new and scoped to the hotel vertical.
--
--   * organisations.hotel_cancellation_hours — free-cancel window. NULL disables
--     self-service cancel (guest is pointed to the phone number, as before); a
--     value N lets a guest cancel until N hours before check-in.
--   * get_public_stay(id)   — SECURITY DEFINER read of a single stay by its
--     unguessable UUID (hotel_stays SELECT is member-only since 055), returning
--     only non-sensitive fields + whether it is cancellable right now.
--   * cancel_public_stay(id) — SECURITY DEFINER cancel, enforcing the window and
--     current status. Cancelling frees the room (availability/trigger already
--     exclude 'cancelled').
-- ============================================================

ALTER TABLE organisations
  ADD COLUMN hotel_cancellation_hours int
    CHECK (hotel_cancellation_hours IS NULL OR hotel_cancellation_hours >= 0);

COMMENT ON COLUMN organisations.hotel_cancellation_hours IS
  'Hotel free-cancel window: hours before check-in a guest may self-cancel. '
  'NULL = self-service cancel disabled.';

-- Read a single stay by id for the guest-facing manage page. SECURITY DEFINER so
-- it works for anon despite the member-only hotel_stays SELECT policy; returns
-- only fields safe to show the booker (no admin_notes, no other guests' data).
CREATE OR REPLACE FUNCTION public.get_public_stay(p_id uuid)
RETURNS TABLE (
  id                 uuid,
  org_name           text,
  org_slug           text,
  booking_theme      text,
  contact_phone      text,
  room_name          text,
  check_in           date,
  check_out          date,
  guests             int2,
  total_amount       numeric,
  status             text,
  cancellation_hours int,
  cancellable        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id,
    o.name::text,
    o.slug::text,
    o.booking_theme,
    o.contact_phone,
    r.name,
    s.check_in,
    s.check_out,
    s.guests,
    s.total_amount,
    s.status,
    o.hotel_cancellation_hours,
    (
      s.status IN ('pending','approved')
      AND o.hotel_cancellation_hours IS NOT NULL
      AND now() < (s.check_in::timestamptz - make_interval(hours => o.hotel_cancellation_hours))
    ) AS cancellable
  FROM hotel_stays s
  JOIN organisations o ON o.id = s.org_id
  LEFT JOIN resources r ON r.id = s.room_type_id
  WHERE s.id = p_id;
$$;

REVOKE ALL ON FUNCTION public.get_public_stay(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_stay(uuid) TO anon, authenticated;

-- Cancel a stay within policy. Returns a status code the UI maps to a message.
CREATE OR REPLACE FUNCTION public.cancel_public_stay(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s hotel_stays%ROWTYPE;
  v_hours int;
BEGIN
  SELECT * INTO s FROM hotel_stays WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF s.status = 'cancelled' THEN
    RETURN 'already_cancelled';
  END IF;

  IF s.status NOT IN ('pending','approved') THEN
    RETURN 'not_cancellable';
  END IF;

  SELECT hotel_cancellation_hours INTO v_hours FROM organisations WHERE id = s.org_id;
  IF v_hours IS NULL THEN
    RETURN 'not_cancellable';   -- self-service cancel disabled for this org
  END IF;

  IF now() >= (s.check_in::timestamptz - make_interval(hours => v_hours)) THEN
    RETURN 'too_late';
  END IF;

  UPDATE hotel_stays SET status = 'cancelled', updated_at = now() WHERE id = p_id;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_public_stay(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_public_stay(uuid) TO anon, authenticated;
