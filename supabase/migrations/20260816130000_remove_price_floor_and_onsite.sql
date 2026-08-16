-- ============================================================
-- 20260816130000_remove_price_floor_and_onsite.sql
--
-- Reverses the ₾5 service-price floor introduced four days earlier by
-- 20260812120000_min_service_price, and re-opens the on-site (pay-in-person)
-- booking path that the floor had made unreachable.
--
-- Why the floor is going away: the business decision is a flat ₾1 platform fee
-- per appointment (platform_config.billing_config.appointment_price), charged to
-- the BUSINESS. What the business charges its own customer — including ₾0 for a
-- free consultation — is none of the platform's concern. Forcing every service
-- above ₾5 only existed to guarantee a gateway charge, which the on-site path
-- below removes the need for.
--
-- Deposits are unaffected: deposit_value was always `>= 0` (fixed) / `0..100`
-- (percent), so ₾0 deposits were already legal. The `services_price_min` CHECK
-- was the only floor in the schema.
--
-- NOT included here: restoring the 47 services this floor silently repriced from
-- ₾0 to ₾5 on 2026-08-16. Those are prod-specific UUIDs, so they live in
-- supabase/rollback/20260816_pre_push_snapshot.sql and are replayed as a one-off
-- against the hosted project, not baked into a migration.
--
-- The on-site path needs NO new writer: the pre-084 direct-insert route is still
-- fully intact and guarded —
--   RLS  appointments_public_insert / customers_insert (OTP-gated)
--   trg_enforce_booking_verification   OTP must be verified + unconsumed
--   trg_00_normalize_guest_appointment pins status/payment_*, raises deposit_required
--   trg_enforce_slot_capacity          084 advisory lock + capacity re-check
--   trg_enforce_appointment_limit      billing gate (20260816120000)
--   trg_enforce_booking_advance_window
-- so a client-side in-person insert is race-safe and cannot self-approve or
-- self-mark-paid. create_guest_booking stays dropped.
-- ============================================================

-- --------------------------------------------------------
-- 1. Replace the ≥5 floor with the ≥0 floor that predated it (022's
--    services_price_non_negative, which 20260812120000 dropped).
--    Added VALID, not NOT VALID: every row already satisfies >= 0.
-- --------------------------------------------------------
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_price_min;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'services_price_non_negative'
       AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_price_non_negative CHECK (price >= 0);
  END IF;
END $$;

-- --------------------------------------------------------
-- 2. The column DEFAULT was raised to 5 by the floor migration; put it back to
--    0 so an insert that omits price means "free", not "₾5".
-- --------------------------------------------------------
ALTER TABLE services ALTER COLUMN price SET DEFAULT 0;

COMMENT ON COLUMN services.price IS
  'What the business charges its customer, in ₾. ₾0 is legal (free consultation) '
  'and routes the booking down the on-site path — the platform fee is a flat '
  'per-appointment charge to the business (billing_config.appointment_price), '
  'independent of this. The ₾5 floor from 20260812120000 was removed 2026-08-16.';

-- --------------------------------------------------------
-- 3. On-site payment as an org-level option.
--
--    organisations.payment_config is already the {method: {enabled}} map that
--    get_public_org projects into `payment_methods` (it aggregates over every
--    key), so `in_person` needs no schema change — only a backfill so existing
--    orgs have an explicit flag instead of a missing key.
--
--    Default ON: before 2026-07-22 every org accepted in-person payment, and an
--    org with no gateway configured would otherwise be unable to take any
--    booking at all now that ₾0 services are legal again.
-- --------------------------------------------------------
UPDATE organisations
   SET payment_config = coalesce(payment_config, '{}'::jsonb)
                        || jsonb_build_object('in_person', jsonb_build_object('enabled', true))
 WHERE payment_config -> 'in_person' IS NULL;

COMMENT ON COLUMN organisations.payment_config IS
  'Per-method config map {method: {enabled, …}}. Gateway entries (bog/tbc) also '
  'carry credentials — NEVER readable by anon: get_public_org projects only the '
  '`enabled` flag per key into payment_methods. `in_person` is flag-only and '
  'controls whether the booking form offers "pay on site" (re-added 2026-08-16).';
