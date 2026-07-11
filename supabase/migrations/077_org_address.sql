-- ============================================================
-- 077_org_address.sql
-- Business address on organisations. Set by the owner in Business-info
-- settings; the send-sms edge function appends it to the booking-confirmation
-- SMS ("Address: …") so the customer knows where to come.
--
-- Grants: owners already reach the column through their table-level
-- SELECT/UPDATE (only billing columns are trigger-guarded, see 072). anon's
-- SELECT is column-scoped (042), so grant the new public column explicitly —
-- it's the business's public street address, same sensitivity as
-- contact_phone.
-- ============================================================

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN organisations.address IS
  'Public street address, shown to customers in the booking-confirmation SMS.';

GRANT SELECT (address) ON organisations TO anon;
