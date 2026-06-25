-- ============================================================
-- 041_public_org_rpc.sql
-- Security fix H2: `organisations` has a public (USING (true)) SELECT
-- policy so the /book/:slug page can load without auth. But the
-- payment_config JSONB is documented to hold per-org gateway
-- secrets, and owner_id identifies the account owner — neither
-- should be world-readable.
--
-- Fix:
--   * get_public_org(slug): SECURITY DEFINER accessor returning only
--     the safe booking fields plus a derived `payment_methods`
--     object that exposes ONLY the per-provider `enabled` flags the
--     booking form needs (never raw secrets).
--   * Revoke anon's column access to payment_config and owner_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_org(p_slug text)
RETURNS TABLE (
  id              uuid,
  name            text,
  description     text,
  contact_phone   text,
  logo_url        text,
  slug            text,
  booking_theme   text,
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
    -- Strip everything except the `enabled` flag from each provider entry so no
    -- secret keys can ride along.
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

-- Keep the other public booking columns readable, but hide secrets/owner from
-- anonymous callers. The booking form now reads these via get_public_org().
REVOKE SELECT (payment_config, owner_id) ON organisations FROM anon;
