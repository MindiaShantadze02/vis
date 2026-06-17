-- ============================================================
-- 015_email_invitations.sql
-- Run AFTER 014_pending_first_ordering.sql.
--
-- Adds email as an alternative invitation channel alongside phone/SMS.
-- The phone column becomes optional and a new email column is added; an
-- invitation must carry at least one of the two. This is additive — the
-- phone path is untouched, so reverting to phone-only later needs no
-- schema change.
-- ============================================================

ALTER TABLE invitations ALTER COLUMN phone_number DROP NOT NULL;

ALTER TABLE invitations ADD COLUMN email text;

-- An invitation needs a way to reach the invitee.
ALTER TABLE invitations
  ADD CONSTRAINT invitations_contact_present
  CHECK (phone_number IS NOT NULL OR email IS NOT NULL);

-- Basic email shape check (mirrors the client-side isValidEmail).
ALTER TABLE invitations
  ADD CONSTRAINT invitations_email_format
  CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

COMMENT ON TABLE invitations IS
  'Pending admin invitations. Delivered by phone (SMS) or email; token sent to the invitee.';
