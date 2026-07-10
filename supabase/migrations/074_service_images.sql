-- ============================================================
-- 074_service_images.sql
--
-- Per-service image gallery. Businesses can attach photos to a service; they
-- show on the admin service list, the onboarding services step, and the public
-- booking page's service picker.
--
-- Design mirrors service_staff (a per-service child table: public SELECT so the
-- anonymous booking page renders images by reading rows directly, org-scoped
-- writes) and the member-photos storage bucket (062). One PUBLIC storage bucket
-- holds the files; this metadata table holds ordering + the resolved URL.
--
-- Storage path convention:  {org_id}/{service_id}/{uuid}.{ext}
-- ============================================================

-- ------------------------------------------------------------
-- Composite-unique target on services so service_images can reference
-- (service_id, org_id) together. This makes the child row's org_id provably
-- equal to its service's org_id — a member can't attach an image row to another
-- org's service (the RLS insert check only proves org_id ∈ caller's orgs; the
-- FK proves that org_id actually owns that service).
-- ------------------------------------------------------------
ALTER TABLE public.services
  ADD CONSTRAINT services_id_org_unique UNIQUE (id, org_id);

-- ------------------------------------------------------------
-- Metadata table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id     uuid NOT NULL,
  service_id uuid NOT NULL,
  url        text NOT NULL,
  sort_order smallint NOT NULL DEFAULT 0,
  CONSTRAINT service_images_org_fkey
    FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE CASCADE,
  -- Composite FK: the service must belong to this org (see note above).
  CONSTRAINT service_images_service_fkey
    FOREIGN KEY (service_id, org_id) REFERENCES public.services(id, org_id) ON DELETE CASCADE,
  CONSTRAINT service_images_url_len CHECK (char_length(url) <= 2048)
);

CREATE INDEX IF NOT EXISTS service_images_service_idx
  ON public.service_images (service_id, sort_order);

-- ------------------------------------------------------------
-- RLS: public read (anon booking page), org-member writes. Mirrors
-- service_staff's policy set exactly.
-- ------------------------------------------------------------
ALTER TABLE public.service_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_images_public_select ON public.service_images;
CREATE POLICY service_images_public_select ON public.service_images
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS service_images_member_insert ON public.service_images;
CREATE POLICY service_images_member_insert ON public.service_images
  FOR INSERT TO public WITH CHECK (org_id = ANY (get_user_org_ids()));

DROP POLICY IF EXISTS service_images_member_update ON public.service_images;
CREATE POLICY service_images_member_update ON public.service_images
  FOR UPDATE TO public USING (org_id = ANY (get_user_org_ids()));

DROP POLICY IF EXISTS service_images_member_delete ON public.service_images;
CREATE POLICY service_images_member_delete ON public.service_images
  FOR DELETE TO public USING (org_id = ANY (get_user_org_ids()));

-- ------------------------------------------------------------
-- Storage bucket: service-images (public read, 5 MB cap — same as the old
-- catalog-images bucket; larger than the 2 MB logo/photo caps because service
-- photos are shown large on the booking page).
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('service-images', 'service-images', true, 5242880)
ON CONFLICT (id) DO NOTHING;

-- Writes restricted to org members acting inside their own org's folder (the
-- first path segment is the org id). SELECT to authenticated is needed so the
-- upsert path can detect a conflicting object (same lesson as member-photos /
-- logos); anon downloads go through the public CDN and need no policy.
DROP POLICY IF EXISTS "service_images_bucket_select" ON storage.objects;
CREATE POLICY "service_images_bucket_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'service-images'
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_org_ids())
  );

DROP POLICY IF EXISTS "service_images_bucket_insert" ON storage.objects;
CREATE POLICY "service_images_bucket_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'service-images'
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_org_ids())
  );

DROP POLICY IF EXISTS "service_images_bucket_update" ON storage.objects;
CREATE POLICY "service_images_bucket_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'service-images'
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_org_ids())
  );

DROP POLICY IF EXISTS "service_images_bucket_delete" ON storage.objects;
CREATE POLICY "service_images_bucket_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'service-images'
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_org_ids())
  );
