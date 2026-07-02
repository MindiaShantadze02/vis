-- ============================================================
-- 056_catalog_images_hardening.sql
-- Run AFTER 055_hotel_availability_inventory.sql.
--
-- Addresses security-advisor WARNings from 054/055:
--
--  * public_bucket_allows_listing: 054 added a public SELECT policy on
--    storage.objects for the catalog-images bucket, which let any client LIST the
--    whole bucket. It is unnecessary — a public bucket already serves downloads
--    via the CDN without an RLS SELECT policy, and the app reads image rows from
--    resource_images/org_images and fetches files by public URL (never storage.list).
--    Drop it.
--
--  * anon/authenticated_security_definer_function_executable: the trigger function
--    enforce_hotel_inventory() and the cron helper sweep_orphan_catalog_images()
--    are SECURITY DEFINER and were EXECUTE-able by anon/authenticated via PostgREST
--    RPC (default PUBLIC grant). Neither is meant to be called directly — the trigger
--    fires from the table and the sweep runs from pg_cron (as postgres, which keeps
--    its grant). Revoke PUBLIC execute. get_room_availability stays anon-executable
--    by design (the booking page calls it, same as get_public_org).
-- ============================================================

DROP POLICY IF EXISTS "catalog_images_public_select" ON storage.objects;

-- Supabase's default privileges grant EXECUTE on new public functions to anon +
-- authenticated directly (not only via PUBLIC), so revoke all three explicitly.
REVOKE ALL ON FUNCTION public.enforce_hotel_inventory() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_orphan_catalog_images() FROM PUBLIC, anon, authenticated;
