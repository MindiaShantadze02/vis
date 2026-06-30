-- ============================================================
-- 046_public_org_vertical.sql
-- Run AFTER 045_restaurant_core.sql.
--
-- The public booking page (/book/:slug) loads the org via get_public_org
-- (041). To render the right booking flow per vertical, that RPC must also
-- return organisations.vertical. Adding an OUT column changes the function's
-- return type, so we DROP + recreate (and re-apply the same grants as 041).
-- Still SECURITY DEFINER and still strips payment secrets — only `vertical`
-- (a non-sensitive enum) is added.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
RETURNS TABLE (
  id              uuid,
  name            text,
  description     text,
  contact_phone   text,
  logo_url        text,
  slug            text,
  booking_theme   text,
  vertical        text,
  payment_methods jsonb
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
