-- ============================================================
-- 054_catalog_images.sql
-- Run AFTER 053_hotel_prepay.sql.
--
-- Generic catalog image storage, keyed to `resources` (room types, tables,
-- services later) plus an org-level property gallery. Nothing in the app stored
-- images before this except the org logo; hotels want per-room photos and a
-- property gallery (exterior/lobby/pool) on the anonymous booking page.
--
-- Design mirrors the existing `logos` bucket (034-036) and `resources` RLS
-- (045): one PUBLIC bucket, org-scoped writes (first path segment = org id),
-- and metadata tables with public SELECT so the anon booking page can render
-- images by querying the rows directly -- exactly how it already reads
-- `resources`. No new RPC is needed for the read path.
--
-- Path convention:
--   {org_id}/rooms/{resource_id}/{uuid}.webp   -- per room-type photos
--   {org_id}/property/{uuid}.webp              -- hotel property gallery
-- ============================================================

-- ------------------------------------------------------------
-- Storage bucket: catalog-images (public, 5 MB cap -- hotel photos are larger
-- than the 2 MB logo cap even after client-side WebP compression).
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('catalog-images', 'catalog-images', true, 5242880)
ON CONFLICT (id) DO NOTHING;

-- Writes restricted to org members acting inside their own org's folder; the
-- first path segment is the org id. Superadmin override mirrors the logos
-- policies (036). SELECT is left open (anon) -- these are public marketing
-- photos on an unauthenticated booking page.
DROP POLICY IF EXISTS "catalog_images_member_insert" ON storage.objects;
CREATE POLICY "catalog_images_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'catalog-images'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );

DROP POLICY IF EXISTS "catalog_images_member_update" ON storage.objects;
CREATE POLICY "catalog_images_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );

DROP POLICY IF EXISTS "catalog_images_member_delete" ON storage.objects;
CREATE POLICY "catalog_images_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND (
      is_superadmin()
      OR ((storage.foldername(name))[1])::uuid = ANY(get_user_org_ids())
    )
  );

-- Public download path. A "public" bucket already serves the anon CDN download,
-- but an explicit SELECT policy lets both anon and authenticated roles read the
-- object row uniformly (mirrors logos_member_select in 036, but open to anon).
DROP POLICY IF EXISTS "catalog_images_public_select" ON storage.objects;
CREATE POLICY "catalog_images_public_select" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'catalog-images');

-- ------------------------------------------------------------
-- resource_images: per-resource photos (room types now, tables/services later).
-- Real table (not attrs jsonb) because we need ordering, a primary flag,
-- per-image alt text, and FK cascade delete.
-- ------------------------------------------------------------
CREATE TABLE resource_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resource_id  uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  storage_path text NOT NULL,               -- object key within catalog-images
  sort_order   int2 NOT NULL DEFAULT 0,
  is_primary   bool NOT NULL DEFAULT false,
  alt_text     text,
  width        int,
  height       int
);

CREATE INDEX idx_resource_images_resource ON resource_images(resource_id, sort_order);
CREATE INDEX idx_resource_images_org ON resource_images(org_id);

COMMENT ON TABLE resource_images IS
  'Marketing photos for a resource (room type / table / service). Storage objects '
  'live in the catalog-images bucket and are NOT removed by this cascade -- the app '
  'deletes them, with a pg_cron orphan sweep as a safety net.';

-- ------------------------------------------------------------
-- org_images: org-level property gallery (hotel exterior / lobby / pool),
-- separate from per-room shots.
-- ------------------------------------------------------------
CREATE TABLE org_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  sort_order   int2 NOT NULL DEFAULT 0,
  is_primary   bool NOT NULL DEFAULT false,
  alt_text     text,
  width        int,
  height       int
);

CREATE INDEX idx_org_images_org ON org_images(org_id, sort_order);

-- ------------------------------------------------------------
-- RLS -- mirrors `resources` (045): public SELECT so the anon booking page reads
-- image rows directly, member INSERT/UPDATE, owner/superadmin DELETE.
-- ------------------------------------------------------------
ALTER TABLE resource_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resource_images_public_select"
  ON resource_images FOR SELECT
  USING (true);

CREATE POLICY "resource_images_member_insert"
  ON resource_images FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "resource_images_member_update"
  ON resource_images FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

CREATE POLICY "resource_images_member_delete"
  ON resource_images FOR DELETE
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

ALTER TABLE org_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_images_public_select"
  ON org_images FOR SELECT
  USING (true);

CREATE POLICY "org_images_member_insert"
  ON org_images FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "org_images_member_update"
  ON org_images FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

CREATE POLICY "org_images_member_delete"
  ON org_images FOR DELETE
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

-- ------------------------------------------------------------
-- Orphan sweep (safety net). Storage objects are NOT removed by the FK cascade
-- on the metadata tables, and a client that crashes between "upload object" and
-- "insert row" (or between "delete row" and "delete object") leaves an unreferenced
-- file. The app deletes objects via the storage API in the happy path (see
-- catalogImages.ts); this pg_cron job is the backstop that removes dangling
-- objects so storage never silently accumulates. Mirrors the pg_cron pattern in
-- 023_auto_complete_appointments.sql.
--
-- An object is referenced when its path matches a tracked storage_path, OR it is
-- the "_thumb.webp" sibling of one (thumbnails share a row, keyed by the main path).
-- A 1-hour grace period protects in-flight uploads whose row insert hasn't landed.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION sweep_orphan_catalog_images()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, storage
AS $$
BEGIN
  DELETE FROM storage.objects o
   WHERE o.bucket_id = 'catalog-images'
     AND o.created_at < now() - interval '1 hour'
     AND NOT EXISTS (
       SELECT 1
       FROM (
         SELECT storage_path FROM resource_images
         UNION ALL
         SELECT storage_path FROM org_images
       ) refs
       WHERE refs.storage_path = CASE
         WHEN o.name LIKE '%\_thumb.webp' ESCAPE '\'
           THEN regexp_replace(o.name, '_thumb\.webp$', '.webp')
         ELSE o.name
       END
     );
END;
$$;

COMMENT ON FUNCTION sweep_orphan_catalog_images IS
  'Deletes catalog-images storage objects with no matching resource_images/org_images '
  'row (main or _thumb sibling), older than 1 hour. Safety net for partial-failure '
  'uploads; the app is the primary deleter. Runs daily via the sweep-orphan-catalog-images cron job.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-orphan-catalog-images') THEN
    PERFORM cron.unschedule('sweep-orphan-catalog-images');
  END IF;

  PERFORM cron.schedule(
    'sweep-orphan-catalog-images',
    '17 3 * * *',   -- daily at 03:17 UTC, off-peak
    $cron$ SELECT sweep_orphan_catalog_images(); $cron$
  );
END;
$$;
