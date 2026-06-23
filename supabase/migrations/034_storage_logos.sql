-- ============================================================
-- 034_storage_logos.sql
-- Run AFTER 033_pending_bookings.sql.
--
-- Provisions the 'logos' storage bucket used by ProfileSettings for org logo
-- uploads (path = "<org_id>/logo.<ext>"). Without it, uploads fail with
-- "Bucket not found". The bucket is public so booking pages can render logos
-- via getPublicUrl with no auth; writes are restricted to org members acting
-- within their own org's folder.
-- ============================================================

-- Public bucket, 2 MB cap (mirrors the client's MAX_LOGO_BYTES).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('logos', 'logos', true, 2097152)
ON CONFLICT (id) DO NOTHING;

-- Org members may upload / replace / remove a logo only inside their own org's
-- folder. The first path segment is the org id (e.g. "<org_id>/logo.png").
-- get_user_org_ids() (migration 002) returns the caller's org ids.
DROP POLICY IF EXISTS "logos_member_insert" ON storage.objects;
CREATE POLICY "logos_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'logos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );

DROP POLICY IF EXISTS "logos_member_update" ON storage.objects;
CREATE POLICY "logos_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'logos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );

DROP POLICY IF EXISTS "logos_member_delete" ON storage.objects;
CREATE POLICY "logos_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'logos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );
