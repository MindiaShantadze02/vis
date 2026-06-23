-- ============================================================
-- 036_storage_logos_select.sql
-- Run AFTER 035_storage_logos_superadmin.sql.
--
-- ProfileSettings uploads the logo with `.upload(path, file, { upsert: true })`,
-- which the storage API executes as INSERT ... ON CONFLICT DO UPDATE. That
-- statement needs SELECT permission on storage.objects to detect the conflicting
-- row -- but 034/035 only created INSERT/UPDATE/DELETE policies. A "public"
-- bucket grants the anonymous CDN *download* path, NOT authenticated-role SELECT
-- on the objects table, so every upsert upload was rejected with
-- "new row violates row-level security policy" (42501).
--
-- Add the matching SELECT policy (same org-scoped + superadmin predicate as the
-- other three) so members and superadmins can upsert / replace their org logo.
-- ============================================================

DROP POLICY IF EXISTS "logos_member_select" ON storage.objects;
CREATE POLICY "logos_member_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'logos'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );
