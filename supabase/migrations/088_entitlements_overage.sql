-- ============================================================
-- 088_entitlements_overage.sql
-- Run AFTER 087_public_booking_slugs.sql.
--
-- Entitlements substrate (keystone for the tiering + booking-features work).
-- Replaces the hard "reached your tier cap → blocked" model with:
--   included allowance  → free
--   beyond allowance    → ALLOWED, and a billable overage_events row is
--                         recorded (for a paying/active org only)
--   no active sub/trial → still hard-blocked (unchanged 'limit_reached')
--
-- What changes vs 072/083:
--   * org_can_accept_appointment is RELAXED to block only 'expired' orgs.
--     Over-allowance is no longer a block, so the enforce_appointment_limit
--     BEFORE trigger (028) now only rejects inserts for a lapsed org.
--   * A new AFTER INSERT/UPDATE trigger record_appointment_overage meters the
--     overage: one overage_events row per over-allowance appointment for an
--     'active' org. Trial orgs get a SOFT allowance (metered as usage but NO
--     billable overage). Voided if the appointment is later cancelled/rejected,
--     to stay consistent with org_usage (which excludes those).
--   * Seats are now UNLIMITED on both tiers (tier_staff_limits → null/null);
--     enforce_staff_limit (072) stays in place but never blocks.
--   * platform_config gains tier_overage_prices and tier_features (all-true for
--     both tiers today — the gate exists for future flips, nothing is gated).
--   * get_org_entitlements(org) — one cacheable RPC the client reads for the
--     usage widget and the (currently permissive) feature gates.
--
-- Billing note: this METERS/RECORDS/DISPLAYS overage only. Charging is a
-- separate subscription-billing track; overage_events is the ledger it will
-- reconcile against once wired.
--
-- Trigger-order note: the appointment INSERT passes the existing BEFORE chain
-- (…→ trg_enforce_slot_capacity, which raises slot_taken under a per-org
-- advisory lock). record_appointment_overage is AFTER INSERT, so it never runs
-- for an insert that was rejected, and org_usage already reflects NEW. The FK
-- overage_events.appointment_id → appointments.id is exactly why metering is
-- AFTER (the row must exist first), not folded into the BEFORE guard.
-- ============================================================

-- --------------------------------------------------------
-- 1. platform_config: overage prices + a per-tier feature map, and relax
--    seats to unlimited on both tiers. Single-row table (id=1), so the
--    column DEFAULT is cosmetic — the UPDATE below is the live value.
-- --------------------------------------------------------
ALTER TABLE platform_config
  ADD COLUMN IF NOT EXISTS tier_overage_prices jsonb NOT NULL
    DEFAULT '{"solo": 0.30, "team": 0.25}'::jsonb,
  ADD COLUMN IF NOT EXISTS tier_features jsonb NOT NULL
    DEFAULT '{
      "solo": {"deposits": true, "waitlist": true, "recurring": true, "analytics": true, "self_service": true},
      "team": {"deposits": true, "waitlist": true, "recurring": true, "analytics": true, "self_service": true}
    }'::jsonb;

COMMENT ON COLUMN platform_config.tier_overage_prices IS
  '₾ charged per appointment created beyond the tier''s included allowance '
  '(tier_limits). Recorded into overage_events; not yet charged (billing is a '
  'separate track).';
COMMENT ON COLUMN platform_config.tier_features IS
  'Per-tier feature entitlement map read by get_org_entitlements and the '
  'client FeatureGate. All-true on both tiers today (nothing gated); flip a '
  'key to false to gate a feature for that tier.';

-- Seats: unlimited on both tiers (decision 2026-07-17). The seat gate
-- (enforce_staff_limit, 072) treats null as unlimited, so it never blocks now.
UPDATE platform_config
   SET tier_staff_limits   = '{"solo": null, "team": null}'::jsonb,
       tier_overage_prices = '{"solo": 0.30, "team": 0.25}'::jsonb,
       tier_features       = '{
         "solo": {"deposits": true, "waitlist": true, "recurring": true, "analytics": true, "self_service": true},
         "team": {"deposits": true, "waitlist": true, "recurring": true, "analytics": true, "self_service": true}
       }'::jsonb
 WHERE id = 1;

-- Keep the column DEFAULT coherent with the live value for any future reseed.
ALTER TABLE platform_config
  ALTER COLUMN tier_staff_limits SET DEFAULT '{"solo": null, "team": null}'::jsonb;

-- --------------------------------------------------------
-- 2. overage_events — the billable-overage ledger. One row per appointment
--    created beyond the included allowance while the org is 'active'. Written
--    ONLY by record_appointment_overage (SECURITY DEFINER, bypasses RLS);
--    clients get read-only visibility of their own org's rows.
-- --------------------------------------------------------
CREATE TABLE overage_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- One overage event per appointment; ON CONFLICT DO NOTHING keeps metering
  -- idempotent, and the appointment's deletion/cancellation voids the charge.
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  -- Billing period the overage falls in (current_period_start, date-truncated).
  period_start  date NOT NULL,
  -- Snapshot of the tier's overage price at accrual time, so a later price
  -- change never rewrites already-accrued charges.
  unit_price    numeric(10,2) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_overage_events_org_period ON overage_events (org_id, period_start);

COMMENT ON TABLE overage_events IS
  'Billable-overage ledger: one row per appointment created beyond the tier''s '
  'included allowance for an active org. Written only by '
  'record_appointment_overage. Charging reconciles against this later.';

ALTER TABLE overage_events ENABLE ROW LEVEL SECURITY;

-- Members (and superadmins) can read their own org's overage rows; no client
-- write path — the trigger is the only writer.
CREATE POLICY "overage_events_select" ON overage_events
  FOR SELECT TO public
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

-- --------------------------------------------------------
-- 3. Relax org_can_accept_appointment: only an 'expired' org (lapsed trial /
--    lapsed paid plan) is blocked. Over-allowance is allowed and metered by
--    record_appointment_overage. Keeps 028's trigger contract (the BEFORE
--    guard raises 'limit_reached' when this returns false), so the only real
--    block now is "no active subscription".
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  -- COALESCE at the call site (028) treats NULL/unknown org as allowed; here
  -- an expired org is the sole hard block. Within-allowance vs overage is
  -- decided later (metering), never blocked.
  SELECT org_subscription_state(p_org_id) <> 'expired';
$$;

COMMENT ON FUNCTION org_can_accept_appointment IS
  'False only when the org is expired (lapsed trial / lapsed paid plan). '
  'Over-allowance bookings are allowed and metered via overage_events. Drives '
  'the booking-page pre-check and the enforce_appointment_limit insert guard.';

-- --------------------------------------------------------
-- 4. record_appointment_overage — AFTER INSERT/UPDATE metering.
--    INSERT: if the org is 'active' and this booking is beyond the included
--            allowance, record one overage_events row (snapshotting the price).
--            Trial = soft allowance (no row). Unlimited tier (null cap) = none.
--    UPDATE: if the appointment transitions INTO cancelled/rejected, void its
--            overage row (org_usage already excludes it — stay consistent).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION record_appointment_overage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier     text;
  v_anchor   timestamptz;
  v_limit    int;
  v_price    numeric(10,2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Cancelling/rejecting an over-allowance booking refunds the count
    -- (decision 2026-07-17), so drop its billable overage too.
    IF NEW.status IN ('rejected', 'cancelled')
       AND OLD.status NOT IN ('rejected', 'cancelled') THEN
      DELETE FROM overage_events WHERE appointment_id = NEW.id;
    END IF;
    RETURN NULL; -- AFTER trigger: return value ignored
  END IF;

  -- INSERT path. A row that lands already cancelled/rejected never counts.
  IF NEW.status IN ('rejected', 'cancelled') THEN
    RETURN NULL;
  END IF;

  -- Overage accrues only for a paying (active) org. Trial = soft allowance;
  -- expired never reaches here (blocked by the BEFORE guard).
  IF org_subscription_state(NEW.org_id) <> 'active' THEN
    RETURN NULL;
  END IF;

  SELECT o.subscription_tier, o.usage_anchor,
         (pc.tier_limits ->> o.subscription_tier)::int,
         (pc.tier_overage_prices ->> o.subscription_tier)::numeric
    INTO v_tier, v_anchor, v_limit, v_price
    FROM organisations o
    CROSS JOIN platform_config pc
   WHERE o.id = NEW.org_id AND pc.id = 1;

  -- Null cap = unlimited tier → never an overage.
  IF v_limit IS NULL THEN
    RETURN NULL;
  END IF;

  -- org_usage now includes NEW (AFTER INSERT): > limit means this booking sits
  -- beyond the included allowance for the period.
  IF org_usage(NEW.org_id) > v_limit THEN
    INSERT INTO overage_events (org_id, appointment_id, period_start, unit_price)
    VALUES (NEW.org_id, NEW.id, current_period_start(v_anchor)::date, COALESCE(v_price, 0))
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION record_appointment_overage IS
  'AFTER INSERT/UPDATE on appointments: records one billable overage_events '
  'row per over-allowance booking for an active org (trial = soft, no row), '
  'and voids it if the booking is later cancelled/rejected. Metering only — '
  'not a block (see org_can_accept_appointment / enforce_appointment_limit).';

CREATE TRIGGER trg_record_appointment_overage
  AFTER INSERT OR UPDATE OF status ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION record_appointment_overage();

-- Trigger functions fire as the table owner regardless of the invoker's
-- privileges, so nothing needs direct EXECUTE. Revoke the default PUBLIC grant
-- so it isn't callable as a bare RPC (matches the 073 internal-fn lockdown).
REVOKE ALL ON FUNCTION record_appointment_overage() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------
-- 5. get_org_entitlements(org) — the single cacheable read the client uses for
--    the usage widget and (currently permissive) feature gates. Members /
--    superadmin only, same gate as org_usage_info.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION get_org_entitlements(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result       jsonb;
  v_period_start timestamptz;
  v_overage_cnt  int;
  v_overage_price numeric(10,2);
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT current_period_start(o.usage_anchor),
         (pc.tier_overage_prices ->> o.subscription_tier)::numeric
    INTO v_period_start, v_overage_price
    FROM organisations o
    CROSS JOIN platform_config pc
   WHERE o.id = p_org_id AND pc.id = 1;

  SELECT count(*)::int INTO v_overage_cnt
    FROM overage_events
   WHERE org_id = p_org_id AND period_start = v_period_start::date;

  SELECT jsonb_build_object(
           'tier',          o.subscription_tier,
           'state',         org_subscription_state(o.id),
           'included',      (pc.tier_limits ->> o.subscription_tier)::int,
           'used',          org_usage(o.id),
           'overage_price', v_overage_price,
           'overage_count', v_overage_cnt,
           'overage_cost',  round(v_overage_cnt * COALESCE(v_overage_price, 0), 2),
           'seat_used',     (SELECT count(*)::int FROM org_members m
                              WHERE m.org_id = o.id AND m.is_bookable),
           'seat_limit',    (pc.tier_staff_limits ->> o.subscription_tier)::int,
           'period_start',  v_period_start,
           'period_end',    v_period_start + interval '1 month',
           'trial_ends_at', o.trial_ends_at,
           'features',      COALESCE(pc.tier_features -> o.subscription_tier, '{}'::jsonb)
         )
    INTO v_result
    FROM organisations o
    CROSS JOIN platform_config pc
   WHERE o.id = p_org_id AND pc.id = 1;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_org_entitlements IS
  'One-round-trip entitlements for a dashboard: tier, derived state, included '
  'allowance, usage, overage price/count/cost, seat usage/limit (null = '
  'unlimited), period bounds, trial end, and the tier feature map. '
  'Members/superadmin only.';

-- Internal/authorized only — no anon. Mirrors org_usage_info's exposure.
REVOKE ALL ON FUNCTION get_org_entitlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_org_entitlements(uuid) TO authenticated;
