-- ============================================================
-- 062_storage_member_photos.sql
-- Run AFTER 061_staff_profiles.sql.
--
-- Provisions the 'member-photos' storage bucket for professional/staff photos
-- (path = "<org_id>/<member_id>.<ext>"), used by TeamSettings and rendered on
-- the public booking staff picker. Mirrors the 'logos' bucket (034): public
-- read so booking pages render photos with no auth; writes restricted to org
-- members acting within their own org's folder.
-- ============================================================

-- Public bucket, 2 MB cap (mirrors the client's MAX_LOGO_BYTES image limit).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('member-photos', 'member-photos', true, 2097152)
ON CONFLICT (id) DO NOTHING;

-- `.upload(path, file, { upsert: true })` runs as INSERT ... ON CONFLICT DO
-- UPDATE, which needs SELECT on storage.objects to detect the conflicting row.
-- A public bucket only grants the anon CDN download path, NOT authenticated-role
-- SELECT, so without this the upsert is rejected with 42501 (same fix as logos
-- in migration 036).
DROP POLICY IF EXISTS "member_photos_member_select" ON storage.objects;
CREATE POLICY "member_photos_member_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );

-- Org members may upload / replace / remove photos only inside their own org's
-- folder. The first path segment is the org id (e.g. "<org_id>/<member_id>.png").
DROP POLICY IF EXISTS "member_photos_member_insert" ON storage.objects;
CREATE POLICY "member_photos_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-photos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );

DROP POLICY IF EXISTS "member_photos_member_update" ON storage.objects;
CREATE POLICY "member_photos_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );

DROP POLICY IF EXISTS "member_photos_member_delete" ON storage.objects;
CREATE POLICY "member_photos_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
  );
