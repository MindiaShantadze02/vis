-- ============================================================
-- 20260821120000_org_contact_email_format.sql
--
-- BUG: organisations.contact_email had NO server-side validation, so the email
-- rules on Settings → Business were client-only and trivially bypassed —
--
--   PATCH /rest/v1/organisations?slug=eq.<slug>  {"contact_email":"not an email"}
--
-- returned 200 and stored it. That value is not private: get_public_org returns
-- contact_email and the booking page renders it as the business's merchant
-- disclosure, so junk (or an injected string) lands on a public page.
--
-- The column was added later than its neighbours (20260719140000, merchant
-- disclosure) and simply never got the CHECK the others have. Everywhere else
-- that takes an email already validates server-side:
--   * invitations.email        → invitations_email_format (015)
--   * setup_requests.contact_email → validated inside submit_setup_request, and
--     the table has NO insert policy, so the RPC is the only writer (078)
-- This closes the last one, and mirrors organisations_contact_phone_format,
-- which has guarded the phone beside it since 010.
--
-- Shape check only, deliberately: same pragmatic regex as the client's
-- isValidEmail and invitations_email_format (non-empty local part, "@", dotted
-- domain). Full RFC 5322 is impractical and rejects valid addresses. Whitespace
-- is excluded anywhere in the value, so a padded " a@b.ge " is refused rather
-- than silently stored — the client already trims before sending.
--
-- The 254-char cap matches FIELD_LIMITS.email on the client and the same cap in
-- submit_setup_request, and stops an unbounded string being parked on a column
-- that is served publicly.
-- ============================================================

-- ── 1. Clean any value that predates the constraint ─
-- Only shape-invalid values are touched, and they are nulled rather than
-- guessed at: contact_email is optional, so NULL is a legitimate resting state
-- and the owner can re-enter the address. Nothing else on the row moves.
UPDATE public.organisations
   SET contact_email = NULL
 WHERE contact_email IS NOT NULL
   AND (
     contact_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR char_length(contact_email) > 254
   );

-- ── 2. The guard ─
-- Split ADD NOT VALID / VALIDATE so the scan runs under SHARE UPDATE EXCLUSIVE
-- instead of blocking writes (the pattern used by services_price_min). The
-- backfill above means VALIDATE actually passes, so unlike the older NOT VALID
-- constraints on this table this one covers pre-existing rows too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organisations_contact_email_format'
       AND conrelid = 'public.organisations'::regclass
  ) THEN
    ALTER TABLE public.organisations
      ADD CONSTRAINT organisations_contact_email_format
      CHECK (
        contact_email IS NULL
        OR (
          contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          AND char_length(contact_email) <= 254
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.organisations VALIDATE CONSTRAINT organisations_contact_email_format;

COMMENT ON CONSTRAINT organisations_contact_email_format ON public.organisations IS
  'Optional contact email, validated server-side because it is PUBLIC (returned '
  'by get_public_org and rendered on the booking page). Mirrors the client''s '
  'isValidEmail and invitations_email_format: non-empty local part, "@", dotted '
  'domain, no whitespace, <= 254 chars (FIELD_LIMITS.email).';
