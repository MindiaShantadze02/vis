-- ============================================================
-- 087_public_booking_slugs.sql
-- Run AFTER 086_refunds.sql.
--
-- SEO groundwork: the /book/:slug business pages have no crawl path (no
-- public directory links to them), so the sitemap.xml Vercel edge function is
-- the only way search engines discover them. It needs an anon-callable list
-- of every live booking-page slug.
--
-- Exposes ONLY the slug — every other public field already flows through
-- get_public_org (078). Expired orgs are excluded: their pages refuse
-- bookings (org_can_accept_appointment, 072), so advertising them to crawlers
-- would only build soft-404-ish dead ends.
--
-- SECURITY DEFINER because org_subscription_state() had its default EXECUTE
-- revoked in 073 (internal helper) and organisations is RLS-scoped; the
-- definer context reaches both while callers get nothing but slugs.
-- ============================================================

CREATE FUNCTION public.list_public_booking_slugs()
RETURNS TABLE (slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.slug::text
  FROM organisations o
  WHERE org_subscription_state(o.id) <> 'expired'
  ORDER BY o.created_at;
$$;

COMMENT ON FUNCTION public.list_public_booking_slugs IS
  'Sitemap feed (SEO): slugs of all orgs whose subscription is not expired. '
  'Anon-callable; returns nothing but the slug.';

REVOKE ALL ON FUNCTION public.list_public_booking_slugs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_booking_slugs() TO anon, authenticated;
