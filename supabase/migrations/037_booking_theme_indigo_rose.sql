-- ============================================================
-- 037_booking_theme_indigo_rose.sql
-- Run AFTER 036_storage_logos_select.sql.
--
-- Adds 'indigo' and 'rose' to the allowed booking themes, in step with
-- the app-wide switch to an indigo-violet palette (see theme.ts and
-- bookingThemes.ts). 'indigo' becomes the new default and mirrors the
-- admin brand colour. The legacy 'classic' and existing 'blue'/'ocean'/
-- 'sunset'/'sporty'/'white' keys stay in the allowed set so existing
-- rows remain valid. As in 018, we deliberately do NOT rewrite existing
-- rows: an UPDATE would re-validate each row and could trip unrelated
-- legacy-data constraints.
-- ============================================================

ALTER TABLE organisations
  DROP CONSTRAINT organisations_booking_theme_check;

ALTER TABLE organisations
  ALTER COLUMN booking_theme SET DEFAULT 'indigo';

ALTER TABLE organisations
  ADD CONSTRAINT organisations_booking_theme_check
  CHECK (booking_theme IN ('indigo','blue','classic','ocean','sunset','sporty','rose','white'));

COMMENT ON COLUMN organisations.booking_theme IS
  'Colour theme key for the public booking pages '
  '(indigo|blue|ocean|sunset|sporty|rose|white; legacy ''classic'' resolves to the default).';
