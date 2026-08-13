-- ============================================================
-- 20260812120000_min_service_price.sql
--
-- Remove the "free service" concept: a service must now cost at least ₾5, so
-- every public booking goes through the payment gateway. Until now price 0 was
-- legal (and was the column DEFAULT), and the booking form branched on it —
-- a ₾0 service skipped payment entirely via create_guest_booking.
--
-- ₾5 is a PLACEHOLDER pending the real business number. When it changes, update
-- the CHECK below *and* MIN_PRICE in client/src/lib/validation.ts together —
-- e2e/data-driven/consistency.spec.ts guards the client half of that pair.
--
-- Fallout worth knowing: with no free path, payment-webhook's hardcoded
-- status='approved' means a public booking can never land 'pending', so
-- organisations.require_approval no longer affects the booking page. The column
-- and api_create_booking's use of it STAY (the public REST API still honours
-- it) — it just becomes DB-only configuration with no UI.
-- ============================================================

-- ── 1. Backfill, so the new constraint can be validated immediately ─
-- Existing free (and sub-minimum) services are lifted to the floor rather than
-- deactivated: they're bookable today and silently breaking them would be worse
-- than a price their owner can edit down... to ₾5.
UPDATE services SET price = 5 WHERE price < 5;

-- ── 2. Replace the ≥0 floor with the ≥5 floor ─
-- 022 added services_price_non_negative as NOT VALID, so pre-022 rows were never
-- checked; the backfill above means we can add the replacement VALID and have it
-- actually mean something. Split ADD/VALIDATE so the full-table scan runs under a
-- SHARE UPDATE EXCLUSIVE lock instead of blocking writes.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_price_non_negative;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'services_price_min'
       AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_price_min CHECK (price >= 5) NOT VALID;
  END IF;
END $$;

ALTER TABLE services VALIDATE CONSTRAINT services_price_min;

-- ── 3. The column default was 0, which now violates the check ─
-- Any insert omitting price (the superadmin panel and the API both send it, but
-- nothing guarantees that forever) would fail. Default to the floor instead.
ALTER TABLE services ALTER COLUMN price SET DEFAULT 5;

-- ── 4. Tombstone create_guest_booking ─
-- Its only caller was the booking form's no-charge branch, deleted with this
-- change. Left defined (not dropped) for reference, but its grants go: it is the
-- one anon-callable writer of appointments that never checks deposits, and a
-- callerless anon RPC is pure attack surface. Same treatment the dead slot/
-- booking functions and claim-waitlist got.
REVOKE EXECUTE ON FUNCTION create_guest_booking(uuid, uuid, timestamptz, text, text, text, text, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION create_guest_booking(uuid, uuid, timestamptz, text, text, text, text, uuid, boolean, text) IS
  'RETIRED 2026-08-12 (min_service_price): the no-charge guest booking path is gone — every public booking now pays online via create-payment + payment-webhook. Kept for reference; EXECUTE revoked from anon/authenticated. Do not re-grant without restoring a deposit check.';
