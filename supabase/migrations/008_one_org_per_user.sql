-- ============================================================
-- 008_one_org_per_user.sql
-- Run AFTER 007_appointment_search_pagination.sql.
--
-- Enforces that each user belongs to at most ONE organisation:
-- a user is either the owner of their own org OR an admin of a
-- single project, never both and never several. This backs the
-- "skip onboarding → empty dashboard, unless added to one project"
-- feature.
--
-- The app already only ever reads a user's *most recent* membership
-- (OrgContext orders by created_at desc, limit 1), so collapsing any
-- pre-existing duplicates to the newest row is behaviour-preserving.
-- ============================================================

-- Drop all but the newest membership per user. The (created_at, id)
-- tuple comparison breaks created_at ties deterministically via id,
-- so exactly one row survives per user even on identical timestamps.
DELETE FROM org_members om
WHERE EXISTS (
  SELECT 1 FROM org_members o2
  WHERE o2.user_id = om.user_id
    AND (o2.created_at, o2.id) > (om.created_at, om.id)
);

-- Hard guarantee going forward.
CREATE UNIQUE INDEX org_members_one_per_user ON org_members (user_id);

COMMENT ON INDEX org_members_one_per_user IS
  'Each user may belong to at most one organisation (one project per user).';
