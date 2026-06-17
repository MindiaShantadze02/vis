-- ============================================================
-- 012_booking_theme_white.sql
-- Run AFTER 011_booking_theme.sql.
--
-- Adds the 'white' option to the booking_theme set introduced in 011.
-- The CHECK constraint must be dropped and recreated to widen the allowed
-- values.
-- ============================================================

ALTER TABLE organisations
  DROP CONSTRAINT organisations_booking_theme_check;

ALTER TABLE organisations
  ADD CONSTRAINT organisations_booking_theme_check
  CHECK (booking_theme IN ('classic','ocean','sunset','sporty','white'));
