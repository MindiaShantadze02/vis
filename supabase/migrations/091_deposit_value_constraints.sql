-- ============================================================
-- 091_deposit_value_constraints.sql
-- Run AFTER 090_public_org_deposit.sql.
--
-- Backend validation for deposit_value (89 only constrained deposit_TYPE). The
-- client already validates, and computeDeposit CLAMPS the resulting amount to
-- [0, price] so an out-of-range value can never overcharge — but that's a
-- runtime safety net, not data integrity. These CHECKs reject bad config at
-- write time (e.g. a direct PostgREST write, or the public API later):
--   * percent deposits must carry a value in 0–100
--   * fixed   deposits must carry a non-negative value
-- A NULL/'none' deposit_type is unconstrained (the `<>` yields NULL → passes).
--
-- Note: we deliberately do NOT tie a fixed deposit to `price` in the DB — price
-- changes over time would retroactively break the CHECK. "fixed ≤ price" is
-- enforced in the service editor (config time) and clamped at charge time.
-- ============================================================

ALTER TABLE services
  ADD CONSTRAINT services_deposit_percent_range
    CHECK (deposit_type <> 'percent'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0 AND deposit_value <= 100)),
  ADD CONSTRAINT services_deposit_fixed_nonneg
    CHECK (deposit_type <> 'fixed'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0));

ALTER TABLE organisations
  ADD CONSTRAINT organisations_deposit_percent_range
    CHECK (deposit_type <> 'percent'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0 AND deposit_value <= 100)),
  ADD CONSTRAINT organisations_deposit_fixed_nonneg
    CHECK (deposit_type <> 'fixed'
           OR (deposit_value IS NOT NULL AND deposit_value >= 0));
