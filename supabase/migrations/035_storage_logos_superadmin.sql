-- ============================================================
-- 035_storage_logos_superadmin.sql
-- Run AFTER 034_storage_logos.sql.
--
-- Superadmins administer every org (including via the /superadmin "view as org"
-- override, where they are NOT an org_members row), so the org-scoped logo write
-- policies from 034 wrongly blocked them with "new row violates RLS". Recreate
-- the three policies with an added is_superadmin() branch.
-- ============================================================

DROP POLICY IF EXISTS "logos_member_insert" ON storage.objects;
CREATE POLICY "logos_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'logos'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );

DROP POLICY IF EXISTS "logos_member_update" ON storage.objects;
CREATE POLICY "logos_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'logos'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );

DROP POLICY IF EXISTS "logos_member_delete" ON storage.objects;
CREATE POLICY "logos_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'logos'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );
