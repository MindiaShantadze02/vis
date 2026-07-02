-- ============================================================
-- 061_staff_profiles.sql
-- Run AFTER 060_booking_theme_citrus.sql.
--
-- Adds "staff profiles": bookable professionals (e.g. a barber) that do NOT
-- have a login account. Until now every org_members row required a user_id, so
-- a business could only publish invited admins/owners as bookable staff. This
-- makes user_id nullable and introduces role='staff' for account-less people.
--
-- service_staff.member_id and appointments.staff_id already reference
-- org_members(id), so staff profiles slot into the existing booking flow with
-- no FK changes. Existing RLS already covers them: owners insert
-- (org_members_insert), org members edit (org_members_member_update), owners
-- delete (org_members_delete), and anon reads bookable rows
-- (org_members_public_bookable_select) — so the new avatar_url column is
-- readable by the public booking page automatically.
--
-- Note: the unique indexes on user_id / (org_id,user_id) permit many NULLs
-- (Postgres treats NULLs as distinct), so multiple staff profiles per org are
-- fine. FK delete rules keep deletion safe: service_staff CASCADE,
-- appointments/pending_bookings SET NULL.
-- ============================================================

ALTER TABLE org_members
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- role gains 'staff'. Enforce the two valid shapes: a login member (owner/admin)
-- always has a user_id; a staff profile ('staff') never does.
ALTER TABLE org_members
  DROP CONSTRAINT IF EXISTS org_members_role_check;

ALTER TABLE org_members
  ADD CONSTRAINT org_members_role_check
  CHECK (
    (role IN ('owner','admin') AND user_id IS NOT NULL)
    OR (role = 'staff' AND user_id IS NULL)
  );

COMMENT ON COLUMN org_members.user_id IS
  'Auth user for login members (owner/admin); NULL for account-less staff profiles (role=staff).';
COMMENT ON COLUMN org_members.avatar_url IS
  'Public URL of the member/professional photo in the member-photos bucket (nullable).';
