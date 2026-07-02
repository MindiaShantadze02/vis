-- ============================================================
-- 059_appointments_only.sql
-- Run AFTER 058_hotel_cancellation.sql.
--
-- Product change: the app is now APPOINTMENTS-ONLY. This reverses the
-- multi-vertical work (migrations 044–058) — restaurant and hotel tables,
-- columns, functions, triggers, storage, and the vertical concept are removed.
-- Appointments are untouched.
--
-- DESTRUCTIVE & IRREVERSIBLE: drops restaurant_reservations, hotel_stays,
-- resources, resource_images, org_images, room_inventory_overrides,
-- pending_stays and their data. Test/demo restaurant & hotel orgs keep their
-- organisations row (now a plain appointments org) but lose their catalog and
-- bookings. Apply on a branch/local first.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Catalog-image orphan sweep (cron + function) — hotel-only.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-orphan-catalog-images') THEN
    PERFORM cron.unschedule('sweep-orphan-catalog-images');
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.sweep_orphan_catalog_images() CASCADE;

-- ------------------------------------------------------------
-- 2. Restore org_usage() to appointments-only (undo 051) BEFORE dropping the
--    reservation/stay tables it currently references.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_usage(p_org_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*)::int
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  WHERE a.org_id = p_org_id
    AND a.status NOT IN ('rejected', 'cancelled')
    AND a.created_at >= current_period_start(o.usage_anchor);
$$;

COMMENT ON FUNCTION org_usage IS
  'Appointments created in the org''s current billing period (excl. rejected/cancelled).';

-- ------------------------------------------------------------
-- 3. Drop restaurant/hotel-only functions & triggers. Triggers on the tables
--    below drop with the tables (step 5); CASCADE also clears any stragglers.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_room_availability(uuid, date, date) CASCADE;
DROP FUNCTION IF EXISTS public.get_public_stay(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_public_stay(uuid) CASCADE;
DROP FUNCTION IF EXISTS enforce_hotel_inventory() CASCADE;
DROP FUNCTION IF EXISTS enforce_resource_image_limit() CASCADE;
DROP FUNCTION IF EXISTS notify_new_reservation() CASCADE;
DROP FUNCTION IF EXISTS notify_new_stay() CASCADE;
DROP FUNCTION IF EXISTS send_reservation_sms() CASCADE;
DROP FUNCTION IF EXISTS send_stay_sms() CASCADE;

-- ------------------------------------------------------------
-- 4. Drop the vertical immutability guard (undo 044).
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS organisations_vertical_immutable ON organisations;
DROP FUNCTION IF EXISTS enforce_vertical_immutable() CASCADE;

-- ------------------------------------------------------------
-- 5. Drop the restaurant/hotel tables. CASCADE clears their triggers, indexes,
--    policies and FKs (e.g. hotel_stays/resource_images → resources).
-- ------------------------------------------------------------
DROP TABLE IF EXISTS pending_stays CASCADE;
DROP TABLE IF EXISTS restaurant_reservations CASCADE;
DROP TABLE IF EXISTS hotel_stays CASCADE;
DROP TABLE IF EXISTS room_inventory_overrides CASCADE;
DROP TABLE IF EXISTS resource_images CASCADE;
DROP TABLE IF EXISTS org_images CASCADE;
DROP TABLE IF EXISTS resources CASCADE;

-- ------------------------------------------------------------
-- 6. Restore get_public_org() to its pre-vertical shape (undo 046/052/055):
--    no vertical / reservation_turn_minutes / check_in_time / check_out_time.
--    (The payment_config/owner_id REVOKEs from 041 remain in effect.)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
RETURNS TABLE (
  id              uuid,
  name            text,
  description     text,
  contact_phone   text,
  logo_url        text,
  slug            text,
  booking_theme   text,
  payment_methods jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.name::text,
    o.description,
    o.contact_phone,
    o.logo_url,
    o.slug::text,
    o.booking_theme,
    COALESCE(
      (
        SELECT jsonb_object_agg(
                 key,
                 jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false))
               )
        FROM jsonb_each(o.payment_config)
      ),
      '{}'::jsonb
    ) AS payment_methods
  FROM organisations o
  WHERE o.slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. Storage: drop the catalog-images access policies (054/056).
--    NOTE: the bucket + any leftover objects are NOT removed here — Postgres
--    blocks DELETE on storage tables (storage.protect_delete). Delete the
--    now-orphaned `catalog-images` bucket from the Storage dashboard / Storage
--    API if you want the space back; without these policies it's inaccessible.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "catalog_images_member_insert" ON storage.objects;
DROP POLICY IF EXISTS "catalog_images_member_update" ON storage.objects;
DROP POLICY IF EXISTS "catalog_images_member_delete" ON storage.objects;
DROP POLICY IF EXISTS "catalog_images_public_select" ON storage.objects;

-- ------------------------------------------------------------
-- 8. Drop the vertical / restaurant / hotel columns on organisations
--    (044 vertical, 052 turn minutes, 055 check-in/out, 058 cancellation).
-- ------------------------------------------------------------
ALTER TABLE organisations
  DROP COLUMN IF EXISTS vertical,
  DROP COLUMN IF EXISTS reservation_turn_minutes,
  DROP COLUMN IF EXISTS check_in_time,
  DROP COLUMN IF EXISTS check_out_time,
  DROP COLUMN IF EXISTS hotel_cancellation_hours;
