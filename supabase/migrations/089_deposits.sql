-- ============================================================
-- 089_deposits.sql
-- Run AFTER 088_entitlements_overage.sql.
--
-- Deposits / prepayment (Phase 2). Lets a business require an upfront deposit
-- (or full prepayment) to confirm a booking — the strongest no-show killer.
-- Reuses the existing online-payment rails end to end (create-payment parks a
-- pending_bookings row for the deposit amount; payment-webhook promotes it to a
-- real appointment only once the charge clears).
--
-- Schema only here; the amount computation lives in create-payment (with a
-- pure computeDeposit mirror in client/src/lib) and the settlement/status flip
-- in payment-webhook.
--
-- Deposit resolution: service.deposit_type NULL = inherit the org default;
-- 'none' = explicitly no deposit (overrides the org); 'fixed'/'percent' =
-- a service-specific deposit. Org default lives on organisations.
-- ============================================================

-- --------------------------------------------------------
-- 1. Per-service deposit (nullable = inherit org default).
-- --------------------------------------------------------
ALTER TABLE services
  ADD COLUMN deposit_type  text CHECK (deposit_type IN ('none', 'fixed', 'percent')),
  ADD COLUMN deposit_value numeric(10,2);

COMMENT ON COLUMN services.deposit_type IS
  'Per-service deposit: NULL inherits the org default; ''none'' overrides it to '
  'no deposit; ''fixed''/''percent'' set a service-specific deposit (value in '
  'deposit_value — ₾ for fixed, 0–100 for percent).';

-- --------------------------------------------------------
-- 2. Org-level deposit default + cancellation/refund policy.
--    The policy fields are consumed by Phase 3 (customer self-service cancel):
--    a deposit is refunded on cancel iff deposit_refundable AND the cancel
--    lands at least cancellation_window_hours before the appointment.
-- --------------------------------------------------------
ALTER TABLE organisations
  ADD COLUMN deposit_type              text NOT NULL DEFAULT 'none'
    CHECK (deposit_type IN ('none', 'fixed', 'percent')),
  ADD COLUMN deposit_value             numeric(10,2),
  ADD COLUMN cancellation_window_hours int NOT NULL DEFAULT 24,
  ADD COLUMN deposit_refundable        boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN organisations.deposit_type IS
  'Org default deposit applied to services that don''t override it (see '
  'services.deposit_type). ''none'' = no deposit by default.';
COMMENT ON COLUMN organisations.cancellation_window_hours IS
  'Hours before the appointment within which a cancel still refunds the deposit '
  '(consumed by the Phase 3 self-service cancel). 0 = refundable up to start.';
COMMENT ON COLUMN organisations.deposit_refundable IS
  'Whether an in-window cancel refunds the deposit at all. false = deposits are '
  'never returned on cancel.';

-- --------------------------------------------------------
-- 3. no_show becomes a first-class appointment status (owners mark it; deposits
--    and analytics depend on it). A no-show consumed the slot, so org_usage
--    still counts it — only rejected/cancelled are excluded — and
--    record_appointment_overage (088) only voids overage on cancel/reject, not
--    on no_show. Booking-page availability excludes it like the others via
--    get_org_busy_slots' NOT IN ('rejected','cancelled') filter (a no-show is a
--    past slot regardless).
-- --------------------------------------------------------
ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed', 'no_show'));

-- --------------------------------------------------------
-- 4. deposit_paid payment status — a booking whose deposit cleared but whose
--    balance is still due in person (distinct from a fully 'paid' online booking).
-- --------------------------------------------------------
ALTER TABLE appointments DROP CONSTRAINT appointments_payment_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'deposit_paid', 'refunded'));

-- --------------------------------------------------------
-- 5. Parked bookings remember whether the charge is a partial deposit, so
--    payment-webhook can set payment_status = deposit_paid vs paid without
--    re-deriving it from a possibly-changed service price at settle time.
-- --------------------------------------------------------
ALTER TABLE pending_bookings
  ADD COLUMN is_deposit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pending_bookings.is_deposit IS
  'True when `amount` is a partial deposit (balance due in person) rather than '
  'full payment. Set by create-payment; read by payment-webhook to choose '
  'deposit_paid vs paid.';
