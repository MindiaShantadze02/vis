-- Optional booking-page cover image: a wide banner the business owner can upload
-- for their public /book/:slug page. Stored in the existing `logos` bucket at
-- path {org_id}/cover.{ext} (org-scoped RLS already covers it), URL kept here.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS cover_url text;

-- Expose cover_url to the anon booking page. Signature changes → DROP + CREATE.
-- Body copied verbatim from 20260804120000_remove_deposits.sql with cover_url
-- appended to the RETURNS TABLE list and the SELECT.
DROP FUNCTION IF EXISTS public.get_public_org(text);
CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, cover_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, cancellation_window_hours integer, contact_email text, require_approval boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT
    o.id, o.name::text, o.description, o.contact_phone, o.address, o.logo_url,
    o.cover_url,
    o.slug::text, o.booking_theme,
    COALESCE(
      (SELECT jsonb_object_agg(key, jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false)))
       FROM jsonb_each(o.payment_config)),
      '{}'::jsonb
    ) AS payment_methods,
    o.reviews_enabled,
    CASE WHEN o.reviews_enabled THEN (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.org_id = o.id) ELSE NULL END,
    CASE WHEN o.reviews_enabled THEN (SELECT count(*)::integer FROM reviews r WHERE r.org_id = o.id) ELSE 0 END,
    o.cancellation_window_hours,
    o.contact_email, o.require_approval
  FROM organisations o WHERE o.slug = p_slug;
$function$;

GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;
