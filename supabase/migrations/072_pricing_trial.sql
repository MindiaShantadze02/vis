-- ============================================================
-- 072_pricing_trial.sql
-- Run AFTER 071_public_api.sql.
--
-- Pricing overhaul (decision record 2026-07-09 + amendment): the Free tier is
-- removed entirely. Every new organisation starts on a 30-day Starter-level
-- trial (no card). Afterwards it must hold a paid plan or it goes "expired":
-- never disabled — dashboard, data and the booking page stay alive — but new
-- bookings are blocked (the existing neutral at-capacity UX) and day-before
-- reminders stop.
--
-- Subscription state is DERIVED from two timestamps, so there is no cron to
-- flip anything and no drift:
--     trial   := subscription_expires_at IS NULL AND trial_ends_at > now()
--     active  := subscription_expires_at > now()          (paid, current)
--     expired := otherwise            (lapsed trial OR lapsed paid sub)
--
-- Also here, because the tier config is being touched anyway:
--   * New caps/prices: starter 150/₾29, pro 400/₾59, business 800/₾99.
--   * Bookable-staff seats per tier (starter 1 / pro 3 / business unlimited),
--     enforced by a BEFORE trigger on org_members — no seat gate existed.
--   * Billing-column guard: the organisations UPDATE policy lets the owner
--     update EVERY column, so an owner could self-assign a paid tier or push
--     trial_ends_at forever via PostgREST. A trigger now restricts
--     subscription_tier / subscription_expires_at / trial_ends_at changes to
--     superadmins and service-role contexts (payment-webhook, cron).
--
-- Ordering note: `tier_limits ->> tier` yields NULL for a missing key and
-- NULL means "unlimited" in org_can_accept_appointment, so converting the
-- orgs off 'free' and rewriting tier_limits MUST land in the same
-- transaction — a window where tier='free' has no config entry would grant
-- those orgs unlimited bookings.
-- ============================================================

-- --------------------------------------------------------
-- 1. Trial window + small persisted UI acks on the org.
-- --------------------------------------------------------
ALTER TABLE organisations
  ADD COLUMN trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  ADD COLUMN trial_expiry_ack_at timestamptz,
  ADD COLUMN link_share_done_at timestamptz,
  ADD COLUMN checklist_dismissed_at timestamptz;

COMMENT ON COLUMN organisations.trial_ends_at IS
  'End of the 30-day Starter-level trial that every org starts with. State is '
  'derived: trial while subscription_expires_at IS NULL and this is in the '
  'future; expired once both have passed. Never flipped by a job.';
COMMENT ON COLUMN organisations.trial_expiry_ack_at IS
  'When the owner dismissed the one-time in-app trial-expiry notice (the '
  'persistent "choose a plan" strip remains). Never delivered by SMS.';
COMMENT ON COLUMN organisations.link_share_done_at IS
  'Onboarding checklist: when the owner copied the booking link for their '
  'Instagram bio (the one step not derivable from data).';
COMMENT ON COLUMN organisations.checklist_dismissed_at IS
  'When the owner dismissed the onboarding checklist card.';

-- --------------------------------------------------------
-- 2. Existing data. Manually-assigned paid orgs (superadmin) predate the
--    "active = subscription_expires_at in the future" rule — give them a
--    long explicit expiry so their state reads 'active'. Then convert the
--    'free' orgs to a fresh Starter trial (013's trg_reset_usage_anchor
--    fires on the tier change: fresh trial = fresh usage period, correct).
-- --------------------------------------------------------
UPDATE organisations
   SET subscription_expires_at = now() + interval '10 years'
 WHERE subscription_tier <> 'free'
   AND subscription_expires_at IS NULL;

UPDATE organisations
   SET subscription_tier = 'starter',
       trial_ends_at     = now() + interval '30 days'
 WHERE subscription_tier = 'free';

-- --------------------------------------------------------
-- 3. 'free' is no longer a valid tier; new orgs default to a Starter trial.
-- --------------------------------------------------------
ALTER TABLE organisations
  DROP CONSTRAINT organisations_subscription_tier_check;

ALTER TABLE organisations
  ADD CONSTRAINT organisations_subscription_tier_check
  CHECK (subscription_tier IN ('starter', 'pro', 'business'));

ALTER TABLE organisations
  ALTER COLUMN subscription_tier SET DEFAULT 'starter';

-- --------------------------------------------------------
-- 4. New caps and list prices + per-tier bookable-staff seats.
--    Caps are margin safety rails, not upgrade levers (record §1): business
--    becomes 800 instead of unlimited.
-- --------------------------------------------------------
ALTER TABLE platform_config
  ADD COLUMN tier_staff_limits jsonb NOT NULL
    DEFAULT '{"starter": 1, "pro": 3, "business": null}'::jsonb;

COMMENT ON COLUMN platform_config.tier_staff_limits IS
  'Max bookable org_members per tier (null = unlimited). Enforced by '
  'enforce_staff_limit on org_members.';

UPDATE platform_config
   SET tier_limits = '{"starter": 150, "pro": 400, "business": 800}'::jsonb,
       tier_prices = '{"starter": 29, "pro": 59, "business": 99}'::jsonb
 WHERE id = 1;

-- --------------------------------------------------------
-- 5. Derived subscription state.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_subscription_state(p_org_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN o.subscription_expires_at IS NOT NULL
     AND o.subscription_expires_at > now() THEN 'active'
    WHEN o.subscription_expires_at IS NULL
     AND o.trial_ends_at > now()           THEN 'trial'
    ELSE 'expired'
  END
  FROM organisations o
  WHERE o.id = p_org_id;
$$;

COMMENT ON FUNCTION org_subscription_state IS
  'trial | active | expired, derived from trial_ends_at / '
  'subscription_expires_at (see 072 header). NULL for an unknown org.';

-- --------------------------------------------------------
-- 6. Enforcement: an expired org accepts no new bookings; otherwise the
--    existing derived-usage cap check is unchanged. Keeps 028's trigger
--    contract (NULL for an unknown org → treated as allowed there).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
      WHEN org_subscription_state(o.id) = 'expired' THEN false
      -- null limit in tier_limits JSON means unlimited
      WHEN (pc.tier_limits ->> o.subscription_tier)::int IS NULL THEN true
      ELSE org_usage(o.id) < (pc.tier_limits ->> o.subscription_tier)::int
    END
  FROM organisations o
  CROSS JOIN platform_config pc
  WHERE o.id = p_org_id AND pc.id = 1;
$$;

COMMENT ON FUNCTION org_can_accept_appointment IS
  'False when the org is expired (lapsed trial / lapsed paid plan) or has '
  'reached its tier''s monthly cap. Drives the booking-page pre-check and '
  'the enforce_appointment_limit insert trigger.';

-- --------------------------------------------------------
-- 7. org_usage_info gains the derived state + trial end so the dashboard
--    gets everything in one round-trip. Return-shape change ⇒ DROP first.
--    (Recreation keeps the 066 member/superadmin gate.)
-- --------------------------------------------------------
DROP FUNCTION org_usage_info(uuid);

CREATE FUNCTION org_usage_info(p_org_id uuid)
RETURNS TABLE(
  tier          text,
  used          int,
  appt_limit    int,
  period_start  timestamptz,
  period_end    timestamptz,
  state         text,
  trial_ends_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
    SELECT
      o.subscription_tier,
      org_usage(o.id),
      (pc.tier_limits ->> o.subscription_tier)::int,
      current_period_start(o.usage_anchor),
      current_period_start(o.usage_anchor) + interval '1 month',
      org_subscription_state(o.id),
      o.trial_ends_at
    FROM organisations o
    CROSS JOIN platform_config pc
    WHERE o.id = p_org_id AND pc.id = 1;
END;
$$;

COMMENT ON FUNCTION org_usage_info IS
  'Tier, limit (null=unlimited), current-period usage/bounds, derived '
  'subscription state and trial end for one org. Members/superadmin only.';

-- --------------------------------------------------------
-- 8. Reminders are a paid/trial feature: skip expired orgs. Everything else
--    in the dispatch (039) is unchanged.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  -- How far before start the reminder goes out. Change here to retune.
  REMINDER_LEAD constant interval := interval '24 hours';
  v_url    text;
  v_secret text;
  r        record;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  -- No SMS endpoint configured yet → do nothing (and don't mark rows), so
  -- reminders start cleanly once a provider/url is set.
  IF v_url IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id
      FROM appointments
     WHERE status = 'approved'
       AND reminder_sent_at IS NULL
       AND scheduled_at > now()
       AND scheduled_at <= now() + REMINDER_LEAD
       -- Expired orgs (lapsed trial / lapsed plan) get no reminders; OTP and
       -- confirmations for already-made bookings are unaffected.
       AND org_subscription_state(org_id) <> 'expired'
  LOOP
    -- Mark first so a slow/failed post can't cause a duplicate on the next tick
    -- (fire-and-forget, same contract as the confirmation trigger).
    UPDATE appointments SET reminder_sent_at = now() WHERE id = r.id;

    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object(
                     'appointment_id', r.id,
                     'message_type', 'appointment_reminder'
                   ),
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-sms-secret', coalesce(v_secret, '')
                   )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch_appointment_reminders failed for appointment %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION dispatch_appointment_reminders IS
  'Sends a one-time ~24h-before reminder SMS (via send-sms / pg_net) for each '
  'approved upcoming appointment of a non-expired org, deduped by '
  'reminder_sent_at. Invoked every 15 minutes by the '
  'dispatch-appointment-reminders cron job.';

-- --------------------------------------------------------
-- 9. Bookable-staff seats. Blocks making one MORE member bookable than the
--    tier allows; rows that are already bookable are untouched (grandfathered
--    on downgrade — the cap only stops new additions). Applies to owners too,
--    same reasoning as enforce_appointment_limit.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_staff_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit int;
  v_count int;
BEGIN
  -- Only when a row is BECOMING bookable.
  IF NOT NEW.is_bookable OR (TG_OP = 'UPDATE' AND OLD.is_bookable) THEN
    RETURN NEW;
  END IF;

  SELECT (pc.tier_staff_limits ->> o.subscription_tier)::int
    INTO v_limit
    FROM organisations o
    CROSS JOIN platform_config pc
   WHERE o.id = NEW.org_id AND pc.id = 1;

  -- null = unlimited (business), or org not found (FK will catch that).
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO v_count
    FROM org_members
   WHERE org_id = NEW.org_id
     AND is_bookable
     AND id IS DISTINCT FROM NEW.id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'staff_limit_reached'
      USING HINT = 'org has reached its subscription_tier bookable-staff limit';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_staff_limit IS
  'BEFORE INSERT/UPDATE guard on org_members: blocks making a member bookable '
  'past platform_config.tier_staff_limits for the org''s tier. Raises '
  '''staff_limit_reached''.';

CREATE TRIGGER trg_enforce_staff_limit
  BEFORE INSERT OR UPDATE OF is_bookable ON org_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_staff_limit();

-- --------------------------------------------------------
-- 10. Billing-column guard. organisations_update (004) is USING(owner), with
--     full-row column grants — so until now an owner could self-assign a paid
--     tier or extend their own trial via PostgREST. Restrict those columns to
--     superadmins and internal/service-role contexts (auth.uid() IS NULL:
--     payment-webhook, cron), mirroring 066's prevent_role_escalation.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_billing_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.subscription_tier       IS DISTINCT FROM OLD.subscription_tier
   OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
   OR NEW.trial_ends_at           IS DISTINCT FROM OLD.trial_ends_at) THEN
    IF NOT (auth.uid() IS NULL OR is_superadmin()) THEN
      RAISE EXCEPTION 'not_authorized: billing fields change only via payment or superadmin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION prevent_billing_self_update IS
  'Blocks subscription_tier / subscription_expires_at / trial_ends_at changes '
  'unless the caller is a superadmin or an internal service-role context. '
  'Closes the owner self-upgrade path opened by the broad organisations '
  'UPDATE policy.';

CREATE TRIGGER trg_prevent_billing_self_update
  BEFORE UPDATE ON organisations
  FOR EACH ROW
  EXECUTE FUNCTION prevent_billing_self_update();
