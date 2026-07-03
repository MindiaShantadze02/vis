-- ============================================================
-- 068 — Verified, appointment-bound reviews
-- ============================================================
-- Each COMPLETED appointment's id is the capability to leave ONE review
-- (/review/:appointmentId), the same "random UUID = capability" model as the
-- booking confirmation page. Only a real attendee has the id, so reviews are
-- verified without accounts. Owner control is a single whole-feature on/off
-- switch (organisations.reviews_enabled) — deliberately NOT per-review
-- moderation, which keeps the aggregate rating un-gameable.
--
-- Public surfaces (badge + list on /book and the embed) read through
-- SECURITY DEFINER RPCs guarded by reviews_enabled; anon never touches the
-- reviews table directly.
-- ============================================================

-- 1. Whole-feature toggle on the org. Default ON: there are no reviews yet, so
--    a fresh org simply shows "no reviews" until one is submitted.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS reviews_enabled boolean NOT NULL DEFAULT true;

-- 2. Reviews table. One row per appointment (UNIQUE appointment_id). author_name
--    is snapshotted at submit time so a later erasure/anonymisation of the guest
--    (064/065) doesn't rewrite historical review authorship, and so the public
--    list never needs to join customers under RLS.
CREATE TABLE IF NOT EXISTS reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  author_name    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Public list + aggregate are per-org, newest first.
CREATE INDEX IF NOT EXISTS reviews_org_created_idx ON reviews (org_id, created_at DESC);

-- 3. RLS: org staff may read their own org's reviews (dashboard). Writes happen
--    only through submit_review() (SECURITY DEFINER) — no direct anon/auth DML.
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_select_own_org ON reviews;
CREATE POLICY reviews_select_own_org ON reviews FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

REVOKE ALL ON reviews FROM anon, authenticated;
GRANT SELECT ON reviews TO authenticated;

-- ------------------------------------------------------------
-- 4. Extend get_public_org() with the review aggregate + toggle so the booking
--    page can render the ★ badge in the same round-trip it already makes.
-- ------------------------------------------------------------
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
  payment_methods jsonb,
  reviews_enabled boolean,
  review_avg      numeric,
  review_count    integer
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
    -- Only expose the aggregate when the feature is on, so a disabled org shows
    -- nothing rather than a stale number.
    CASE WHEN o.reviews_enabled
      THEN (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.org_id = o.id)
      ELSE NULL END AS review_avg,
    CASE WHEN o.reviews_enabled
      THEN (SELECT count(*)::integer FROM reviews r WHERE r.org_id = o.id)
      ELSE 0 END AS review_count
  FROM organisations o
  WHERE o.slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. get_public_reviews(slug): the public reviews list for a booking page /
--    embed. Returns nothing when the org has the feature off.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_reviews(p_slug text, p_limit integer DEFAULT 50)
RETURNS TABLE (
  author_name text,
  rating      smallint,
  comment     text,
  created_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.author_name, r.rating, r.comment, r.created_at
  FROM reviews r
  JOIN organisations o ON o.id = r.org_id
  WHERE o.slug = p_slug
    AND o.reviews_enabled
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_public_reviews(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_reviews(text, integer) TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. get_review_context(appointment_id): everything the /review page needs to
--    pick its state (form vs. "not completed yet" vs. "already reviewed" vs.
--    "reviews disabled" vs. "not found") without leaking anything private.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_review_context(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'org_name',         o.name,
    'slug',             o.slug,
    'booking_theme',    o.booking_theme,
    'service_name',     s.name,
    'scheduled_at',     a.scheduled_at,
    'status',           a.status,
    'reviews_enabled',  o.reviews_enabled,
    'already_reviewed', EXISTS (SELECT 1 FROM reviews r WHERE r.appointment_id = a.id)
  )
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  LEFT JOIN services s ON s.id = a.service_id
  WHERE a.id = p_appointment_id;
$$;

REVOKE ALL ON FUNCTION public.get_review_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_context(uuid) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. submit_review(appointment_id, rating, comment): the one write path.
--    Enforces every rule server-side and returns a small { ok, error } jsonb so
--    the anon client can branch (mirrors the booking-OTP RPCs' shape).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review(
  p_appointment_id uuid,
  p_rating         smallint,
  p_comment        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id  uuid;
  v_status  text;
  v_enabled boolean;
  v_name    text;
  v_comment text;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rating');
  END IF;

  SELECT a.org_id, a.status::text, o.reviews_enabled, c.first_name
    INTO v_org_id, v_status, v_enabled, v_name
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  LEFT JOIN customers c ON c.id = a.customer_id
  WHERE a.id = p_appointment_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reviews_disabled');
  END IF;
  IF v_status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_completed');
  END IF;

  -- Trim + cap the free-text comment; empty becomes NULL.
  v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');
  IF v_comment IS NOT NULL AND char_length(v_comment) > 1000 THEN
    v_comment := left(v_comment, 1000);
  END IF;

  INSERT INTO reviews (org_id, appointment_id, rating, comment, author_name)
  VALUES (v_org_id, p_appointment_id, p_rating, v_comment, v_name)
  ON CONFLICT (appointment_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_reviewed');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, smallint, text) TO anon, authenticated;

COMMENT ON TABLE reviews IS
  'Verified customer reviews, one per completed appointment (UNIQUE appointment_id). '
  'Written only via submit_review(); gated per-org by organisations.reviews_enabled.';
