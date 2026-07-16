-- ============================================================
-- 083_solo_team_tiers.sql
-- Run AFTER 082_appointment_meeting_link.sql.
--
-- Tier overhaul (decision 2026-07-16): the product is marketed to individuals
-- and small businesses only, so the three-tier ladder collapses to two and the
-- Business tier is REMOVED entirely (it was superadmin-assigned only, never
-- self-serve):
--
--     starter  ₾29 / 150 appts / 1 seat   →  solo  ₾19 / 100 appts / 1 seat
--     pro      ₾59 / 400 appts / 3 seats  →  team  ₾39 / 300 appts / UNLIMITED seats
--     business ₾99 / 800 appts / ∞ seats  →  (gone; existing orgs map to team)
--
-- Existing orgs are renamed in place (starter→solo, pro→team, business→team).
-- The trial stays 30 days at Solo level; all derived-state logic (072) reads
-- tier config by key and needs no change.
--
-- Ordering hazard (same as 072): `tier_limits ->> tier` yields NULL for a
-- missing key and NULL means "unlimited" in org_can_accept_appointment, so the
-- org rename and the tier_limits rewrite MUST land in the same transaction.
-- ============================================================

-- --------------------------------------------------------
-- 1. Rename tiers on existing orgs. trg_reset_usage_anchor re-anchors the
--    billing period on any tier change ("buy a plan") — this rename is NOT a
--    purchase, so keep every org's usage anchor intact by disabling it for
--    the bulk update. (trg_prevent_billing_self_update allows this context:
--    auth.uid() IS NULL under the migration role.)
-- --------------------------------------------------------
ALTER TABLE organisations DISABLE TRIGGER trg_reset_usage_anchor;

ALTER TABLE organisations
  DROP CONSTRAINT organisations_subscription_tier_check;

UPDATE organisations
   SET subscription_tier = CASE subscription_tier
                             WHEN 'starter' THEN 'solo'
                             ELSE 'team'  -- pro AND business both map to team
                           END
 WHERE subscription_tier IN ('starter', 'pro', 'business');

ALTER TABLE organisations
  ADD CONSTRAINT organisations_subscription_tier_check
  CHECK (subscription_tier IN ('solo', 'team'));

ALTER TABLE organisations
  ALTER COLUMN subscription_tier SET DEFAULT 'solo';

ALTER TABLE organisations ENABLE TRIGGER trg_reset_usage_anchor;

COMMENT ON COLUMN organisations.trial_ends_at IS
  'End of the 30-day Solo-level trial that every org starts with. State is '
  'derived: trial while subscription_expires_at IS NULL and this is in the '
  'future; expired once both have passed. Never flipped by a job.';

-- --------------------------------------------------------
-- 2. Tier config: caps, list prices, bookable-staff seats.
--    Team seats are UNLIMITED (null) — the seat gate now only exists to keep
--    Solo at exactly one bookable professional.
-- --------------------------------------------------------
UPDATE platform_config
   SET tier_limits       = '{"solo": 100, "team": 300}'::jsonb,
       tier_prices       = '{"solo": 19,  "team": 39}'::jsonb,
       tier_staff_limits = '{"solo": 1,   "team": null}'::jsonb
 WHERE id = 1;

-- --------------------------------------------------------
-- 3. Void any parked checkout intents that still reference an old tier name —
--    settling one via payment-webhook would now violate the CHECK constraint.
--    ('failed' is the closest allowed status; these are dev/mock-gateway rows.)
-- --------------------------------------------------------
UPDATE subscription_payments
   SET status = 'failed'
 WHERE status = 'pending'
   AND tier IN ('starter', 'pro', 'business');
