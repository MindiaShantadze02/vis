-- ============================================================
-- 016_accept_invitation.sql
-- Run AFTER 015_email_invitations.sql.
--
-- Lets an invited user actually SEE and ACCEPT their invitation.
-- Until now invitations were only readable by existing org members
-- (RLS), so an invitee saw nothing, and joining org_members is blocked
-- by RLS for non-owners. This adds:
--   1. an RLS policy so a logged-in user can read invitations addressed
--      to their own email, and
--   2. accept_invitation(), a SECURITY DEFINER function that validates
--      the invite and joins the user to the org (bypassing the
--      owner-only org_members insert policy in a controlled way).
--
-- Matching is by email (auth is email/password). Comparisons are
-- case-insensitive since stored emails are lower-cased.
-- ============================================================

-- An invitee can read their own pending invitation (by email). Combines via
-- OR with the existing member/superadmin select policy.
CREATE POLICY "invitations_invitee_select"
  ON invitations FOR SELECT
  USING (lower(email) = lower(auth.jwt() ->> 'email'));


CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv   invitations%ROWTYPE;
  v_uid   uuid := auth.uid();
  v_email text := lower(auth.jwt() ->> 'email');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_inv
  FROM invitations
  WHERE token = p_token AND accepted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  -- Only the addressed account may accept.
  IF v_inv.email IS NULL OR lower(v_inv.email) IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_account');
  END IF;

  -- Each user belongs to at most one org (org_members_one_per_user).
  IF EXISTS (SELECT 1 FROM org_members WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_in_org');
  END IF;

  INSERT INTO org_members (org_id, user_id, role, joined_at)
  VALUES (v_inv.org_id, v_uid, v_inv.role, now());

  UPDATE invitations SET accepted_at = now() WHERE id = v_inv.id;

  RETURN jsonb_build_object('ok', true, 'org_id', v_inv.org_id);
END;
$$;

COMMENT ON FUNCTION accept_invitation IS
  'Validates an invitation token against the caller''s email and joins them to '
  'the org as a member. Returns {ok, error?|org_id}. SECURITY DEFINER.';
