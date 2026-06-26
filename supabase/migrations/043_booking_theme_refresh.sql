-- ============================================================
-- 043_booking_theme_refresh.sql
-- Run AFTER 042_fix_org_anon_grant.sql.
--
-- Refreshes the customer booking colour themes to the curated 5-palette
-- set (see bookingThemes.ts / the "Customer Form Themes" design):
--   blue (Royal Blue · default) | emerald | terracotta | brass | indigo
--
-- Adds the three new keys ('emerald','terracotta','brass') to the allowed
-- set and makes 'blue' the default again (Royal Blue is the "current" look).
-- The retired keys ('classic','ocean','sunset','sporty','rose','white') stay
-- in the CHECK so existing rows remain valid; the app resolves any retired
-- key to the default via getBookingTheme(). As in 018/037 we deliberately do
-- NOT rewrite existing rows.
-- ============================================================

ALTER TABLE organisations
  DROP CONSTRAINT organisations_booking_theme_check;

ALTER TABLE organisations
  ALTER COLUMN booking_theme SET DEFAULT 'blue';

ALTER TABLE organisations
  ADD CONSTRAINT organisations_booking_theme_check
  CHECK (booking_theme IN (
    'blue','emerald','terracotta','brass','indigo',
    'classic','ocean','sunset','sporty','rose','white'
  ));

COMMENT ON COLUMN organisations.booking_theme IS
  'Colour theme key for the public booking pages '
  '(blue|emerald|terracotta|brass|indigo; retired keys resolve to the default).';
