-- ============================================================
-- 20260724180000_acquisition_source.sql  (BILLING_PLAN T4.2)
--
-- Signup source attribution: the client captures ?src= / UTM (and the
-- Powered-by-Vis ?ref=badge) at landing and persists it here at org creation.
-- Surfaced in the superadmin org list so the acquisition mix is visible.
-- ============================================================
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS acquisition_source text;

DROP FUNCTION IF EXISTS list_orgs_overview();
CREATE OR REPLACE FUNCTION list_orgs_overview()
  RETURNS TABLE(id uuid, name text, slug text, billing_status text, acquisition_source text,
                created_at timestamptz, owner_email text, owner_phone text, contact_phone text,
                member_count integer, usage integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY
    SELECT o.id, o.name::text, o.slug::text, o.billing_status, o.acquisition_source, o.created_at,
           u.email::text, u.phone::text, o.contact_phone,
           (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id), org_usage(o.id)
      FROM organisations o LEFT JOIN auth.users u ON u.id = o.owner_id
     ORDER BY o.created_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION list_orgs_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_orgs_overview() TO authenticated;
