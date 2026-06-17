-- ============================================================
-- 013 — PROPER SUBSCRIPTION USAGE TRACKING
--
-- Replaces the hand-maintained organisations.appointments_used_this_month
-- counter (which only the guest-booking Edge Function incremented, never
-- reset, and which admin manual-entry bypassed entirely) with usage that
-- is DERIVED from the appointments table against a rolling billing period.
--
-- The period is anchored to when the org was created and re-anchored on
-- every subscription tier change ("when users create an account, or buy a
-- plan"). Usage is always correct because nothing is incremented by hand.
-- ============================================================

-- --------------------------------------------------------
-- Billing-period anchor on the org.
-- usage_anchor = the day-of-month the current billing cycle rolls over.
-- Defaults to now() for new orgs; backfilled to created_at for existing.
-- --------------------------------------------------------
ALTER TABLE organisations
  ADD COLUMN usage_anchor timestamptz NOT NULL DEFAULT now();

-- Backfill existing orgs to their signup date. The phone-format constraint
-- (010) was added NOT VALID, so legacy rows with malformed contact_phone would
-- fail re-validation on any UPDATE — skip them and let them keep the now()
-- default rather than failing the migration on unrelated legacy data.
UPDATE organisations
  SET usage_anchor = created_at
  WHERE contact_phone IS NULL OR contact_phone ~ '^[345][0-9]{8}$';

COMMENT ON COLUMN organisations.usage_anchor IS
  'Anchor for the rolling monthly usage period. Set on signup, reset on every '
  'subscription_tier change. Current period start is derived via current_period_start().';

-- The old counter is no longer a source of truth — usage is derived.
ALTER TABLE organisations DROP COLUMN appointments_used_this_month;


-- --------------------------------------------------------
-- current_period_start(anchor) — the most recent monthly rollover at or
-- before now(). Postgres month arithmetic clamps short months (e.g. an
-- anchor on the 31st rolls to the 28th/30th), so this is safe for any day.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION current_period_start(p_anchor timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  -- Whole months elapsed since the anchor, then add them back to the anchor.
  WITH m AS (
    SELECT (
      (date_part('year', now()) - date_part('year', p_anchor)) * 12
      + (date_part('month', now()) - date_part('month', p_anchor))
    )::int AS months
  )
  SELECT CASE
    WHEN p_anchor + (m.months || ' months')::interval > now()
      THEN p_anchor + ((m.months - 1) || ' months')::interval
    ELSE p_anchor + (m.months || ' months')::interval
  END
  FROM m;
$$;

COMMENT ON FUNCTION current_period_start IS
  'Start of the billing period that contains now(), for a given monthly anchor date.';


-- --------------------------------------------------------
-- org_usage(org) — bookings consumed in the current billing period.
-- Counts by created_at (a booking consumes quota when it is made),
-- excluding rejected/cancelled appointments.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_usage(p_org_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*)::int
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  WHERE a.org_id = p_org_id
    AND a.status NOT IN ('rejected', 'cancelled')
    AND a.created_at >= current_period_start(o.usage_anchor);
$$;

COMMENT ON FUNCTION org_usage IS
  'Appointments created in the org''s current billing period (excl. rejected/cancelled).';


-- --------------------------------------------------------
-- org_usage_info(org) — everything the UI needs in one round-trip:
-- tier, configured limit (null = unlimited), usage, and period bounds.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_usage_info(p_org_id uuid)
RETURNS TABLE (
  tier          text,
  used          int,
  appt_limit    int,
  period_start  timestamptz,
  period_end    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    o.subscription_tier,
    org_usage(o.id),
    (pc.tier_limits ->> o.subscription_tier)::int,
    current_period_start(o.usage_anchor),
    current_period_start(o.usage_anchor) + interval '1 month'
  FROM organisations o
  CROSS JOIN platform_config pc
  WHERE o.id = p_org_id AND pc.id = 1;
$$;

COMMENT ON FUNCTION org_usage_info IS
  'Tier, limit (null=unlimited), current-period usage and bounds for one org.';


-- --------------------------------------------------------
-- Enforcement now reads the same derived usage as the UI — no drift.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    CASE
      -- null limit in tier_limits JSON means unlimited (e.g. business tier)
      WHEN (pc.tier_limits ->> o.subscription_tier)::int IS NULL THEN true
      ELSE org_usage(o.id) < (pc.tier_limits ->> o.subscription_tier)::int
    END
  FROM organisations o
  CROSS JOIN platform_config pc
  WHERE o.id = p_org_id AND pc.id = 1;
$$;


-- --------------------------------------------------------
-- Re-anchor the billing period whenever the tier changes ("buy a plan").
-- Runs wherever subscription_tier is updated — superadmin override, a
-- future payment webhook, or a self-serve upgrade — so no call site has
-- to remember to reset usage.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION reset_usage_anchor_on_tier_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    NEW.usage_anchor := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reset_usage_anchor
  BEFORE UPDATE OF subscription_tier ON organisations
  FOR EACH ROW
  EXECUTE FUNCTION reset_usage_anchor_on_tier_change();
