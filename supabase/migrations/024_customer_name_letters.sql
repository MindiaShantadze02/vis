-- ============================================================
-- 024_customer_name_letters.sql
-- Run AFTER 023_auto_complete_appointments.sql.
--
-- Customer first/last names must be letters only — no digits or
-- symbols. Spaces, hyphens and apostrophes are allowed (real names
-- use them, e.g. "Anne-Marie", "O'Brien", composite Georgian names),
-- but at least one actual letter is required.
--
-- [[:alpha:]] is locale-aware: with the database's UTF-8 ctype it
-- matches Georgian (მარიამ) as well as Latin letters, mirroring the
-- client-side isValidPersonName (\p{L}) check.
--
-- NOT VALID (as in 022) so the constraint applies to new/updated rows
-- without failing the migration on any pre-existing malformed name.
-- ============================================================

ALTER TABLE customers
  ADD CONSTRAINT customers_first_name_letters
  CHECK (
    first_name ~ '^[[:alpha:][:space:]''’-]+$'
    AND first_name ~ '[[:alpha:]]'
  ) NOT VALID;

ALTER TABLE customers
  ADD CONSTRAINT customers_last_name_letters
  CHECK (
    last_name IS NULL OR (
      last_name ~ '^[[:alpha:][:space:]''’-]+$'
      AND last_name ~ '[[:alpha:]]'
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT customers_first_name_letters ON customers IS
  'First name is letters only (plus space/hyphen/apostrophe); mirrors client isValidPersonName.';
COMMENT ON CONSTRAINT customers_last_name_letters ON customers IS
  'Last name, when present, is letters only (plus space/hyphen/apostrophe); mirrors client isValidPersonName.';
