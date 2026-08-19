-- ============================================================
-- 20260829120000_booking_page_views.sql
--
-- Booking-page view counter: how many people actually saw a business's booking
-- form, to read next to how many of them booked.
--
-- PRIVACY BY SHAPE: this stores a per-org DAILY COUNTER and nothing else. No
-- visitor id, no IP, no user agent, no session token ever reaches the server.
-- "One visitor per day" is decided in the browser (client/src/lib/pageViews.ts
-- keeps the last counted day per slug in localStorage) and the server only ever
-- receives "+1". There is nothing stored here that could be attributed to a
-- person, which keeps the feature clear of the consent/retention machinery the
-- customer tables live under.
--
-- The trade-off, stated plainly: client-side dedupe is defeatable by clearing
-- storage or using a private window, so treat these as an interest signal, not
-- an audited figure. Nothing bills off them.
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_page_views (
  org_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  day    date NOT NULL,
  views  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day)
);

ALTER TABLE booking_page_views ENABLE ROW LEVEL SECURITY;

-- Members can read their own org's numbers (ready for an owner-facing analytics
-- panel); superadmins read everything. anon reads NOTHING — it only writes
-- through the RPC below.
DROP POLICY IF EXISTS booking_page_views_select ON booking_page_views;
CREATE POLICY booking_page_views_select ON booking_page_views FOR SELECT
  USING ((org_id = ANY (get_user_org_ids())) OR is_superadmin());

REVOKE ALL ON booking_page_views FROM anon, authenticated;
GRANT SELECT ON booking_page_views TO authenticated;

-- Takes the SLUG (what the visitor's URL actually carries) rather than an org
-- id, so a caller can't probe org uuids, and silently no-ops on an unknown slug
-- so it never reveals whether one exists.
--
-- Dated in Asia/Tbilisi to match the rest of the booking domain — slots, the
-- reminder cron and the billing period all use business time, not UTC.
CREATE OR REPLACE FUNCTION public.record_booking_page_view(p_slug text)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid;
BEGIN
  SELECT id INTO v_org FROM organisations WHERE slug = p_slug;
  IF v_org IS NULL THEN RETURN; END IF;

  INSERT INTO booking_page_views (org_id, day, views)
  VALUES (v_org, (now() AT TIME ZONE 'Asia/Tbilisi')::date, 1)
  ON CONFLICT (org_id, day)
  DO UPDATE SET views = booking_page_views.views + 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_booking_page_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_booking_page_view(text) TO anon, authenticated;

COMMENT ON FUNCTION public.record_booking_page_view IS
  'Increments today''s booking-page view counter for a slug. Stores no visitor '
  'identifier — one-per-visitor-per-day is enforced in the browser. No-ops on '
  'an unknown slug.';

-- ── Surface the numbers to superadmin ────────────────────────────────────
-- Both rebuilt from the LIVE definitions with only the view columns added —
-- see the header of 20260824120000 for why editing from the migration files
-- instead is how a control silently disappears.
--
-- list_orgs_overview must be DROPped because its return type changes. A drop
-- takes the grants with it, so EXECUTE is re-applied below; losing it would 403
-- the entire organisations list.
DROP FUNCTION IF EXISTS public.list_orgs_overview();

CREATE FUNCTION public.list_orgs_overview()
  RETURNS TABLE (id uuid, name text, slug text, billing_status text,
                 acquisition_source text, created_at timestamptz,
                 owner_email text, owner_phone text, contact_phone text,
                 member_count integer, usage integer, views integer)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY
    SELECT o.id, o.name::text, o.slug::text, o.billing_status, o.acquisition_source, o.created_at,
           u.email::text, u.phone::text, o.contact_phone,
           (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id), org_usage(o.id),
           (SELECT coalesce(sum(v.views), 0)::int FROM booking_page_views v WHERE v.org_id = o.id)
      FROM organisations o LEFT JOIN auth.users u ON u.id = o.owner_id
     ORDER BY o.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_orgs_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_orgs_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_stats()
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN jsonb_build_object(
    'total_orgs', (SELECT count(*) FROM organisations),
    'total_appointments', (SELECT count(*) FROM appointments),
    'signups_last_30d', (SELECT count(*) FROM organisations WHERE created_at >= now() - interval '30 days'),
    'booking_views_total', (SELECT coalesce(sum(views), 0) FROM booking_page_views),
    'booking_views_30d', (SELECT coalesce(sum(views), 0) FROM booking_page_views
                           WHERE day >= (now() AT TIME ZONE 'Asia/Tbilisi')::date - 30),
    'orgs_by_billing_status', (SELECT coalesce(jsonb_object_agg(billing_status, c), '{}'::jsonb)
                                 FROM (SELECT billing_status, count(*) c FROM organisations GROUP BY billing_status) t));
END;
$function$;
