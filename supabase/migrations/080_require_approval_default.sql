-- ============================================================
-- 080_require_approval_default.sql
-- Run AFTER 079_setup_request_phone_normalize.sql.
--
-- Flip the default booking posture: NEW organisations now REQUIRE manual
-- approval (organisations.require_approval DEFAULT true). Guest bookings for a
-- fresh org arrive as 'pending' until the business approves them; a business
-- can still opt into auto-approve from Settings -> Booking page.
--
-- Only the column DEFAULT changes — the require_approval column is NOT NULL, so
-- every EXISTING org already stores an explicit value and is untouched (their
-- chosen preference, and the e2e seed org's auto-approve state, are preserved).
--
-- The status-deriving logic in normalize_guest_appointment() and
-- api_create_booking() (075) already reads the flag and needs no change:
-- require_approval = true -> 'pending', false -> 'approved'.
-- ============================================================

ALTER TABLE organisations
  ALTER COLUMN require_approval SET DEFAULT true;

COMMENT ON COLUMN organisations.require_approval IS
  'When true (default since 080), guest bookings are created as ''pending'' and '
  'must be approved manually. When false, guest bookings auto-approve on insert. '
  'Toggled per-org from Settings -> Booking page.';
