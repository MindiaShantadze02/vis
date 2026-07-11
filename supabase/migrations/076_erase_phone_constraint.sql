-- ============================================================
-- 076_erase_phone_constraint.sql
-- Run AFTER 075_auto_approve_bookings.sql.
--
-- Bug: both anonymization paths write phone_number = '' on customers —
--   * erase_customer_data() (064, the dashboard's Art. 16 erase button)
--   * purge_expired_data()'s retention sweep (065)
-- but customers_phone_format (010) only allows ^[345][0-9]{8}$, so BOTH have
-- failed since they shipped: the button surfaced
--   'new row for relation "customers" violates check constraint
--    "customers_phone_format"'
-- and the nightly sweep swallowed the same error as a WARNING and quietly
-- never anonymized anything.
--
-- Fix: allow the empty-string "anonymized" sentinel alongside a valid number.
-- (phone_number is NOT NULL, so '' — what both functions already write — is
-- the sentinel; relaxing NOT NULL instead would ripple into client types.)
-- A guest could now hand-craft a customer insert with '', but such a row is
-- unusable junk: booking verification (OTP) can never pass for an empty
-- phone, so no appointment can attach to it — same exposure as any junk row.
-- ============================================================

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_format;

-- NOT VALID like the original: enforced on new writes, pre-existing legacy
-- rows (spaces / +995 prefixes) stay untouched.
ALTER TABLE customers
  ADD CONSTRAINT customers_phone_format
  CHECK (phone_number = '' OR phone_number ~ '^[345][0-9]{8}$') NOT VALID;

COMMENT ON CONSTRAINT customers_phone_format ON customers IS
  'Georgian national number: 9 digits, mobile starts with 5, landline 3/4. No '
  'country code. Empty string = anonymized (erase_customer_data / retention sweep).';
