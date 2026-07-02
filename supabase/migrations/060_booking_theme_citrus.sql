-- ============================================================
-- 060_booking_theme_citrus.sql
-- Run AFTER 059_appointments_only.sql.
--
-- The booking palette was refreshed again (see bookingThemes.ts): the default
-- is now 'citrus' (Ink & Citrus), which replaces the previous 'blue' default.
-- The CHECK from 043 allowed 'blue' but not 'citrus', so selecting the citrus
-- theme in settings failed with organisations_booking_theme_check.
--
-- Adds 'citrus' to the allowed set and makes it the new default. Every retired
-- key ('blue' now among them) stays in the CHECK so existing rows remain valid;
-- the app resolves any retired/unknown key to the default via getBookingTheme().
-- As in 018/037/043 we deliberately do NOT rewrite existing rows.
-- ============================================================

ALTER TABLE organisations
  DROP CONSTRAINT organisations_booking_theme_check;

ALTER TABLE organisations
  ALTER COLUMN booking_theme SET DEFAULT 'citrus';

ALTER TABLE organisations
  ADD CONSTRAINT organisations_booking_theme_check
  CHECK (booking_theme IN (
    'citrus','emerald','terracotta','brass','indigo',
    'blue','classic','ocean','sunset','sporty','rose','white'
  ));

COMMENT ON COLUMN organisations.booking_theme IS
  'Colour theme key for the public booking pages '
  '(citrus|emerald|terracotta|brass|indigo; retired keys resolve to the default).';
