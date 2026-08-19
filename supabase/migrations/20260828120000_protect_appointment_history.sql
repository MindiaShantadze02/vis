-- ============================================================
-- 20260828120000_protect_appointment_history.sql
--
-- appointments.service_id was ON DELETE CASCADE, so deleting a service deleted
-- every appointment ever booked for it. Measured on the seed org: removing ONE
-- service would have destroyed 1,067 appointments, 236 of them billable.
--
-- Two problems, either one sufficient on its own:
--
--   1. BILLING EVASION that defeats every guard added in 20260824120000 and
--      20260825120000. Those work through a BEFORE UPDATE trigger
--      (billable_locked_at / billable_period_at) — a cascade DELETE never fires
--      it, so the rows just vanish and close_billing_period_for_org counts
--      nothing. Delete the service before month end and the month is free.
--      Verified: as the org owner, DELETE FROM services took the appointment
--      count for that service from 1,067 to 0.
--
--   2. DATA LOSS. The business loses its own history and every customer's
--      booking record, irreversibly, behind a single confirm dialog.
--
-- RESTRICT instead. services.is_active already exists and the booking page
-- already filters on it, so archiving is the intended way to retire a service;
-- deleting stays available while nothing has been booked (the "I typed the name
-- wrong" case), which is verified in the same test.
--
-- billing_line_items.appointment_id is ON DELETE SET NULL, so invoices already
-- issued keep their totals either way.
-- ============================================================
ALTER TABLE appointments DROP CONSTRAINT appointments_service_id_fkey;
ALTER TABLE appointments ADD CONSTRAINT appointments_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT;

COMMENT ON CONSTRAINT appointments_service_id_fkey ON appointments IS
  'RESTRICT, not CASCADE: deleting a service must never erase booked '
  'appointments — that destroyed customer history and zeroed the month''s bill. '
  'Retire a service with is_active = false.';
