-- ============================================================
-- 063_phone_invitations.sql
-- Run AFTER 062_storage_member_photos.sql.
--
-- Admin invitations were matched by email (015/016), but authentication is
-- phone-based — phone-registered users have no email on their JWT, so the
-- invitee could never see or accept an invite. This reverts invitation matching
-- to phone, which is what the table was originally built for (invitations.
-- phone_number, national 9-digit ^[345][0-9]{8}$). The email column from 015 is
-- left in place (harmless) but is no longer used by the invite flow.
--
-- Matching: the auth phone claim is E.164-ish ("995XXXXXXXXX"); the national
-- number is its last 9 digits, which is exactly what invitations.phone_number
-- stores (see formatGeorgianPhone).
-- ============================================================

-- (1) Invitee can read their own pending invitation, matched by phone.
DROP POLICY IF EXISTS "invitations_invitee_select" ON invitations;
CREATE POLICY "invitations_invitee_select"
  ON invitations FOR SELECT
  USING (
    phone_number IS NOT NULL
    AND phone_number = right(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '[^0-9]', '', 'g'), 9)
  );

-- (2) accept_invitation() validates the token against the caller's phone.
CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv   invitations%ROWTYPE;
  v_uid   uuid := auth.uid();
  v_phone text := right(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '[^0-9]', '', 'g'), 9);
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

  -- Only the addressed phone may accept.
  IF v_inv.phone_number IS NULL OR v_inv.phone_number IS DISTINCT FROM v_phone THEN
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
  'Validates an invitation token against the caller''s phone (national 9-digit) '
  'and joins them to the org as a member. Returns {ok, error?|org_id}. SECURITY DEFINER.';
