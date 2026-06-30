-- ============================================================
-- 052_reservation_turn_minutes.sql
-- Run AFTER 051_unified_booking_metering.sql.
--
-- Makes the restaurant table turn time (how long a reservation holds a table)
-- a per-org setting instead of a hardcoded 120 min in the booking UI. Additive;
-- only the restaurant vertical reads it. DROP+recreate get_public_org (as in
-- 046) so the public booking page can read the org's value.
-- ============================================================

ALTER TABLE organisations
  ADD COLUMN reservation_turn_minutes int2 NOT NULL DEFAULT 120
    CHECK (reservation_turn_minutes > 0);

COMMENT ON COLUMN organisations.reservation_turn_minutes IS
  'Restaurant table turn time in minutes (how long a reservation holds a table). '
  'Used by the restaurant booking flow / availability. Default 120.';

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
