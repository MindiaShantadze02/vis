-- ============================================================
-- 010_phone_format.sql
-- Run AFTER 009_service_duration_limit.sql.
--
-- Enforces the Georgian phone-number format at the database level so
-- bookings (which insert into customers directly via RLS, bypassing the
-- edge function) and org contact details can't store malformed numbers.
--
-- Stored form is the bare 9-digit national number, no country code:
--   - mobile   → starts with 5
--   - landline → starts with 3 or 4
-- This mirrors isValidGeorgianPhone / formatGeorgianPhone on the client.
--
-- The constraints are added NOT VALID: they apply to every new insert and
-- update, but pre-existing rows (which may hold legacy formats with spaces
-- or a +995 prefix) are left untouched rather than failing the migration.
-- ============================================================

ALTER TABLE customers
  ADD CONSTRAINT customers_phone_format
  CHECK (phone_number ~ '^[345][0-9]{8}$') NOT VALID;

ALTER TABLE organisations
  ADD CONSTRAINT organisations_contact_phone_format
  CHECK (contact_phone IS NULL OR contact_phone ~ '^[345][0-9]{8}$') NOT VALID;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_phone_format
  CHECK (phone_number ~ '^[345][0-9]{8}$') NOT VALID;

COMMENT ON CONSTRAINT customers_phone_format ON customers IS
  'Georgian national number: 9 digits, mobile starts with 5, landline 3/4. No country code.';
