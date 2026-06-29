-- ============================================================
-- 044_org_vertical.sql
-- Run AFTER 043_booking_theme_refresh.sql.
--
-- Introduces the multi-vertical foundation. Each organisation belongs to
-- exactly one booking vertical:
--   'appointments' (current product) | 'restaurant' | 'hotel'
--
-- ADDITIVE & SAFE for the live product:
--   * New column DEFAULTs to 'appointments', so every existing org is
--     backfilled as an appointments business with zero behaviour change.
--   * No existing column/table/trigger is altered.
--   * The vertical is IMMUTABLE once set (decision: a business picks its
--     vertical at onboarding and is locked to it). A future superadmin-only
--     override can replace the trigger with a SECURITY DEFINER path if ever
--     needed.
-- ============================================================

ALTER TABLE organisations
  ADD COLUMN vertical text NOT NULL DEFAULT 'appointments'
    CHECK (vertical IN ('appointments','restaurant','hotel'));

COMMENT ON COLUMN organisations.vertical IS
  'Booking vertical this business operates in '
  '(appointments|restaurant|hotel). Set once at onboarding, then immutable.';

-- ------------------------------------------------------------
-- Immutability guard: block any UPDATE that changes vertical.
-- Only fires when the value actually changes, so the many existing
-- UPDATE flows on organisations (profile edits, theme, tier upgrade)
-- are unaffected.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_vertical_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.vertical IS DISTINCT FROM OLD.vertical THEN
    RAISE EXCEPTION 'organisations.vertical is immutable (cannot change from % to %)',
      OLD.vertical, NEW.vertical
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_vertical_immutable
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION enforce_vertical_immutable();
