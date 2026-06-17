-- ============================================================
-- 011_booking_theme.sql
-- Run AFTER 010_phone_format.sql.
--
-- Lets each organisation pick a colour theme for its public booking pages
-- (the flow customers see). Stored as a short key resolved on the client to
-- a gradient/background (see client/src/theme/bookingThemes.ts). Constrained
-- to the curated set so an unknown value can't sneak in.
-- ============================================================

ALTER TABLE organisations
  ADD COLUMN booking_theme text NOT NULL DEFAULT 'classic'
  CHECK (booking_theme IN ('classic','ocean','sunset','sporty'));

COMMENT ON COLUMN organisations.booking_theme IS
  'Colour theme key for the public booking pages (classic|ocean|sunset|sporty).';
