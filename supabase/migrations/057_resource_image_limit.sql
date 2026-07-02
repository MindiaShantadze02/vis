-- ============================================================
-- 057_resource_image_limit.sql
-- Run AFTER 056_catalog_images_hardening.sql.
--
-- Server-side enforcement of per-tier photo limits, consistent with how bookings
-- are metered (028/051). The client already caps the count via tiers.ts
-- (imagesPerRoomForTier), but this trigger is the authoritative backstop so the
-- limit can't be bypassed by calling the API directly. Limits mirror tiers.ts:
-- free 3, starter 6, pro 10, business unlimited.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_resource_image_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier  text;
  v_limit int;
  v_count int;
BEGIN
  SELECT subscription_tier INTO v_tier FROM organisations WHERE id = NEW.org_id;

  v_limit := CASE v_tier
    WHEN 'free'    THEN 3
    WHEN 'starter' THEN 6
    WHEN 'pro'     THEN 10
    ELSE NULL      -- business (or anything unrecognised) = unlimited
  END;

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count FROM resource_images WHERE resource_id = NEW.resource_id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'image_limit_reached'
      USING HINT = 'subscription tier allows ' || v_limit || ' photos per room';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_resource_image_limit IS
  'BEFORE INSERT guard on resource_images: rejects uploads past the org tier''s '
  'per-room photo limit (free 3 / starter 6 / pro 10 / business unlimited). '
  'Mirrors tiers.ts imagesPerRoom; backstop for the client-side cap.';

DROP TRIGGER IF EXISTS trg_enforce_resource_image_limit ON resource_images;
CREATE TRIGGER trg_enforce_resource_image_limit
  BEFORE INSERT ON resource_images
  FOR EACH ROW EXECUTE FUNCTION enforce_resource_image_limit();

REVOKE ALL ON FUNCTION public.enforce_resource_image_limit() FROM PUBLIC, anon, authenticated;
