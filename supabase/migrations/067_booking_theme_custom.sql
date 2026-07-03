-- ============================================================
-- 067_booking_theme_custom.sql
-- Run AFTER 066_security_hardening.sql.
--
-- Lets a business set a CUSTOM brand accent colour for its public booking page
-- (and embed), so the form can match the business's website. booking_theme now
-- accepts either a preset key (as before) OR a '#RRGGBB' hex; the client derives
-- the full accent palette from that one colour (see customBookingTheme() in
-- bookingThemes.ts). No RPC change — get_public_org already returns booking_theme
-- as text, so the embed inherits the custom colour for free.
--
-- As in 060/043/037 we keep all retired preset keys valid and do NOT rewrite rows.
-- ============================================================

ALTER TABLE organisations
  DROP CONSTRAINT organisations_booking_theme_check;

ALTER TABLE organisations
  ADD CONSTRAINT organisations_booking_theme_check
  CHECK (
    booking_theme ~ '^#[0-9A-Fa-f]{6}$'
    OR booking_theme IN (
      'citrus','emerald','terracotta','brass','indigo',
      'blue','classic','ocean','sunset','sporty','rose','white'
    )
  );

COMMENT ON COLUMN organisations.booking_theme IS
  'Colour theme for the public booking pages: a preset key '
  '(citrus|emerald|terracotta|brass|indigo; retired keys resolve to the default) '
  'OR a custom brand accent as a #RRGGBB hex.';
