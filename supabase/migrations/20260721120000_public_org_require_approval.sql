-- Expose `require_approval` on the public booking RPC so the booking flow can
-- tell the customer the truth about what happens after they book. Since
-- auto-approval became the default (migration 075) the Step-3 "pay in person"
-- hint hardcoded "booking needs confirmation" for every org — misleading on an
-- auto-approve org, where an in-person booking is confirmed instantly. The
-- client now branches the hint on this flag. Appending a column changes the
-- OUT-row type, so DROP first (same pattern as the merchant-disclosure republish).
DROP FUNCTION IF EXISTS public.get_public_org(text);
CREATE OR REPLACE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, deposit_type text, deposit_value numeric, cancellation_window_hours integer, deposit_refundable boolean, contact_email text, business_id_number text, require_approval boolean)
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
    o.business_id_number,
    o.require_approval
  FROM organisations o
  WHERE o.slug = p_slug;
$function$;

-- Public booking page reads this as anon; keep the grants it had before the drop.
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated, service_role;
