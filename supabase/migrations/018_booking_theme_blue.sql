-- ============================================================
-- 018_booking_theme_blue.sql
-- Run AFTER 017_service_location.sql.
--
-- Adds 'blue' as the new default booking theme, in step with the
-- app-wide switch to a flat, light blue palette. 'blue' replaces the
-- old violet 'classic' option in the UI (see bookingThemes.ts), but
-- 'classic' is kept in the allowed set so existing rows stay valid —
-- the client resolves the retired 'classic' key to 'blue' at render
-- time (getBookingTheme falls back to the default). We deliberately do
-- NOT rewrite existing rows: an UPDATE would re-validate each row and
-- trip unrelated legacy-data constraints (e.g. old invalid phones).
-- ============================================================

ALTER TABLE organisations
  DROP CONSTRAINT organisations_booking_theme_check;

ALTER TABLE organisations
  ALTER COLUMN booking_theme SET DEFAULT 'blue';

ALTER TABLE organisations
  ADD CONSTRAINT organisations_booking_theme_check
  CHECK (booking_theme IN ('blue','classic','ocean','sunset','sporty','white'));

COMMENT ON COLUMN organisations.booking_theme IS
  'Colour theme key for the public booking pages '
  '(blue|ocean|sunset|sporty|white; legacy ''classic'' resolves to blue).';
