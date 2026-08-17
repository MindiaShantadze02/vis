-- ============================================================
-- 20260817130000_service_thumbnail.sql
--
-- Retire the per-service image GALLERY (074) in favour of a single thumbnail.
--
-- The gallery earned its own child table, a lightbox, a sidebar strip and a
-- "+N photos" badge — a lot of surface for what businesses actually use it for:
-- one representative photo of the service. A service now carries at most one
-- image, stored inline on the row.
--
--   * services.image_url  — the thumbnail (public CDN URL), NULL = no photo
--   * service_images      — DROPPED, after backfilling the first image
--
-- The `service-images` storage BUCKET stays exactly as it is (public read,
-- 5 MB cap, org-scoped writes from 074 + the MIME allowlist from 081): the
-- thumbnail still lives there under {org_id}/{service_id}/{uuid}.{ext}.
--
-- Old gallery files beyond the first are left in the bucket. They are
-- unreferenced and harmless; deleting storage objects from SQL isn't safe here
-- (no transactional guarantee against the storage API), and the retention job
-- has no claim on them.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The new column
-- ------------------------------------------------------------
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS image_url text;

-- Same bound the gallery's url column carried.
ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_image_url_len;
ALTER TABLE public.services
  ADD CONSTRAINT services_image_url_len CHECK (char_length(image_url) <= 2048);

COMMENT ON COLUMN public.services.image_url IS
  'Single service thumbnail (public URL in the service-images bucket). '
  'Replaces the service_images gallery table.';

-- ------------------------------------------------------------
-- 2. Backfill: keep each service's lead photo, drop the rest
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'service_images'
  ) THEN
    UPDATE public.services s
       SET image_url = i.url
      FROM (
        SELECT DISTINCT ON (service_id) service_id, url
          FROM public.service_images
         ORDER BY service_id, sort_order, created_at
      ) i
     WHERE i.service_id = s.id
       AND s.image_url IS NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Drop the gallery table (policies, indexes and the composite FK go with it)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS public.service_images;

-- NOTE: services_id_org_unique (added by 074 so the child row's org_id was
-- provably its service's org_id) is deliberately KEPT. It is a plain composite
-- unique on an already-unique id, it costs nothing, and any future per-service
-- child table wants the same tenant-integrity anchor.
