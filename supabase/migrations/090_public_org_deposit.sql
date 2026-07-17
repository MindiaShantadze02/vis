-- ============================================================
-- 090_public_org_deposit.sql
-- Run AFTER 089_deposits.sql.
--
-- Surface the org's deposit default + cancellation policy on the public booking
-- RPC so the booking page can (a) resolve a service's effective deposit — a
-- service with deposit_type NULL inherits the org default — and (b) force the
-- online-payment path when a deposit is required, instead of letting a customer
-- pick pay-in-person and bypass it. The actual charge is still computed
-- server-side in create-payment; these fields only drive the UI.
--
-- Return-shape change ⇒ DROP + CREATE (carries the 078 body forward verbatim,
-- plus four columns). Grants unchanged (anon/authenticated).
-- ============================================================

DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
RETURNS TABLE (
  id                        uuid,
  name                      text,
  description               text,
  contact_phone             text,
  address                   text,
  logo_url                  text,
  slug                      text,
  booking_theme             text,
  payment_methods           jsonb,
  reviews_enabled           boolean,
  review_avg                numeric,
  review_count              integer,
  deposit_type              text,
  deposit_value             numeric,
  cancellation_window_hours integer,
  deposit_refundable        boolean
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
    o.deposit_refundable
  FROM organisations o
  WHERE o.slug = p_slug;
$$;
REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;
