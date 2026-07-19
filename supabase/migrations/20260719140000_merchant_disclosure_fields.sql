-- Merchant legal disclosure (2026-07-19 legal review, E-Commerce Law №3110 Art. 4
-- / Consumer Rights Law №1455 Art. 5): a business must disclose its legal identity
-- to consumers — name, identification/registration number, address, email, phone.
-- The booking page already shows name + optional phone/address; this adds the two
-- missing mandatory fields (ID number + email) and exposes them publicly.

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS contact_email      text,
  ADD COLUMN IF NOT EXISTS business_id_number text;

COMMENT ON COLUMN public.organisations.contact_email IS
  'Business contact email shown on the public booking page (merchant disclosure — E-Commerce Law Art. 4).';
COMMENT ON COLUMN public.organisations.business_id_number IS
  'Business identification / registration number for merchant disclosure (E-Commerce Law Art. 4 / Consumer Rights Law Art. 5).';

-- Republish get_public_org with the two new public fields appended (same column
-- order as before, plus contact_email + business_id_number at the end). Adding
-- columns changes the OUT-row type, which requires a DROP first.
DROP FUNCTION IF EXISTS public.get_public_org(text);
CREATE OR REPLACE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, deposit_type text, deposit_value numeric, cancellation_window_hours integer, deposit_refundable boolean, contact_email text, business_id_number text)
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
    o.business_id_number
  FROM organisations o
  WHERE o.slug = p_slug;
$function$;

-- Public booking page reads this as anon; keep the grants it had before the drop.
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated, service_role;
