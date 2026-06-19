-- ============================================================
-- 026_multi_superadmin.sql
-- Run AFTER 025_max_advance_days.sql.
--
-- Turns the single, static superadmin (platform_config.superadmin_user_id,
-- mirrored into a VITE_SUPERADMIN_USER_ID env var) into a dynamic set of
-- superadmins managed from the /superadmin UI ("me, and whoever I choose").
--
--   1. A `superadmins` table — the new source of truth.
--   2. is_superadmin() rewritten to check membership of that table.
--   3. Bootstrap seed from the owner's email + any legacy config value.
--   4. SECURITY DEFINER RPCs for the UI: list/add/remove superadmins,
--      platform stats, and an all-orgs overview.
--
-- The platform_config.superadmin_user_id column is left in place (other
-- comments/seed scripts reference it) but is no longer authoritative.
-- ============================================================

-- ── 1. superadmins table ────────────────────────────────────
CREATE TABLE superadmins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  added_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE superadmins IS
  'Source of truth for platform superadmins. Checked by is_superadmin().';

ALTER TABLE superadmins ENABLE ROW LEVEL SECURITY;

-- Only superadmins can see the roster. No recursion: is_superadmin() is
-- SECURITY DEFINER and reads the table bypassing RLS (same pattern as
-- get_user_org_ids()). All mutations go through the RPCs below.
CREATE POLICY "superadmins_select" ON superadmins FOR SELECT
  USING (is_superadmin());


-- ── 2. is_superadmin() now checks the table ─────────────────
CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM superadmins WHERE user_id = auth.uid());
$$;


-- ── 3. Bootstrap seed (idempotent) ──────────────────────────
-- The owner, looked up by email, plus any pre-existing single superadmin.
INSERT INTO superadmins (user_id)
SELECT id FROM auth.users WHERE lower(email) = lower('shantadze200202@gmail.com')
ON CONFLICT DO NOTHING;

INSERT INTO superadmins (user_id)
SELECT superadmin_user_id FROM platform_config
WHERE id = 1 AND superadmin_user_id IS NOT NULL
ON CONFLICT DO NOTHING;


-- ── 4. Admin RPCs ───────────────────────────────────────────
-- All are SECURITY DEFINER and self-gate on is_superadmin().

-- List superadmins with their emails (auth.users isn't client-readable).
CREATE OR REPLACE FUNCTION list_superadmins()
RETURNS TABLE (user_id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
    SELECT s.user_id, u.email::text, s.created_at
    FROM superadmins s
    JOIN auth.users u ON u.id = s.user_id
    ORDER BY s.created_at;
END;
$$;

-- Promote a user (by email) to superadmin. Returns {ok, error?}.
CREATE OR REPLACE FUNCTION add_superadmin(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  INSERT INTO superadmins (user_id, added_by)
  VALUES (v_uid, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid);
END;
$$;

-- Remove a superadmin. Refuses to remove the last one (lockout guard).
CREATE OR REPLACE FUNCTION remove_superadmin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF (SELECT count(*) FROM superadmins) <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'last_superadmin');
  END IF;

  DELETE FROM superadmins WHERE user_id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Platform-wide aggregates for the overview page.
CREATE OR REPLACE FUNCTION platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN jsonb_build_object(
    'total_orgs',         (SELECT count(*) FROM organisations),
    'total_appointments', (SELECT count(*) FROM appointments),
    'signups_last_30d',   (SELECT count(*) FROM organisations WHERE created_at >= now() - interval '30 days'),
    'orgs_by_tier',       (SELECT coalesce(jsonb_object_agg(subscription_tier, c), '{}'::jsonb)
                             FROM (SELECT subscription_tier, count(*) c
                                     FROM organisations GROUP BY subscription_tier) t)
  );
END;
$$;

-- All orgs with the aggregates the list view needs, in one round-trip.
CREATE OR REPLACE FUNCTION list_orgs_overview()
RETURNS TABLE (
  id                uuid,
  name              text,
  slug              text,
  subscription_tier text,
  created_at        timestamptz,
  owner_email       text,
  member_count      int,
  usage             int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
    SELECT
      o.id,
      o.name::text,
      o.slug::text,
      o.subscription_tier,
      o.created_at,
      u.email::text,
      (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id),
      org_usage(o.id)
    FROM organisations o
    LEFT JOIN auth.users u ON u.id = o.owner_id
    ORDER BY o.created_at DESC;
END;
$$;
