-- ============================================================
-- 20260803140000_drop_business_id_number.sql
--
-- Remove the business identification/registration number field entirely.
-- It was added in 20260719140000 as a booking-page merchant disclosure and
-- surfaced by get_public_org; the product no longer collects or shows it.
-- Recreate get_public_org without the column (return signature changes, so
-- DROP + CREATE), then drop organisations.business_id_number.
-- ============================================================
DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, deposit_type text, deposit_value numeric, cancellation_window_hours integer, deposit_refundable boolean, contact_email text, require_approval boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    o.id,
    o.name::text,
    o.description,
    o.contact_phone,
    o.address,
    o.logo_url,
    o.slug::text,
    o.booking_theme,
    COALESCE(
      (
        SELECT jsonb_object_agg(
                 key,
                 jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false))
               )
        FROM jsonb_each(o.payment_config)
      ),
      '{}'::jsonb
    ) AS payment_methods,
    o.reviews_enabled,
    CASE WHEN o.reviews_enabled
      THEN (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.org_id = o.id)
      ELSE NULL END AS review_avg,
    CASE WHEN o.reviews_enabled
      THEN (SELECT count(*)::integer FROM reviews r WHERE r.org_id = o.id)
      ELSE 0 END AS review_count,
    o.deposit_type,
    o.deposit_value,
    o.cancellation_window_hours,
    o.deposit_refundable,
    o.contact_email,
    o.require_approval
  FROM organisations o
  WHERE o.slug = p_slug;
$function$;

ALTER TABLE public.organisations DROP COLUMN IF EXISTS business_id_number;
