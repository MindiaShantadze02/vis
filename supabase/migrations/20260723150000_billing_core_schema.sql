-- ============================================================
-- 20260723150000_billing_core_schema.sql  (BILLING_PLAN T1.1)
--
-- POST-PAID USAGE BILLING — additive core schema. This lands the new tables,
-- config and the organisations.billing_status column WITHOUT touching the old
-- tier/credit/trial model yet; the deletion + guard rewrites are T1.2. Keeping
-- T1.1 purely additive means nothing breaks between the two migrations.
--
-- Model (Phase 0 decisions, 2026-07-23):
--   * A billable appointment = one whose scheduled_at falls in the closing
--     period AND whose final status is in {approved, completed, no_show,
--     deposit_paid} (excludes pending/cancelled/rejected). Counted at period
--     close by OCCURRENCE date — no consume-on-insert / refund machinery.
--   * ₾0 appointments bill; the price is a flat billing_config.appointment_price,
--     never services.price.
--   * amount_due = count*price + prior period's rolled-forward balance; below
--     minimum_charge → charge nothing, carry it forward, status 'waived'.
--     Zero-appointment months are 'waived' too.
--   * Suspension blocks new bookings only (T1.2/T3.2); data stays alive.
-- The billing period IS the usage period: seed period_start from
-- current_period_start(usage_anchor) so counting and billing share one clock.
-- ============================================================

-- ── 1. organisations.billing_status ───────────────────────────────────────────
-- Replaces the tier/trial-derived org_subscription_state (removed in T1.2).
--   active    — normal; bookings accepted.
--   past_due  — a charge failed; still accepting bookings during the grace window.
--   suspended — grace elapsed; new bookings blocked (data/page stay alive).
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'active'
  CHECK (billing_status IN ('active', 'past_due', 'suspended'));

COMMENT ON COLUMN organisations.billing_status IS
  'Post-paid billing state (active/past_due/suspended). Drives '
  'org_can_accept_appointment (suspended blocks new bookings). Owners cannot '
  'self-modify it — see prevent_billing_self_update.';

-- ── 2. billing_config in platform_config (superadmin-editable, no deploy) ───────
-- appointment_price: ₾ per billable appointment.
-- minimum_charge:    ₾ floor; below it the period rolls forward instead of charging.
-- notice_days:       advance notice before a charge (T2.3).
-- grace_days:        past_due → suspended after this many days (T3.1).
-- retry_schedule:    days after first failure to retry the charge (T3.1).
ALTER TABLE platform_config
  ADD COLUMN IF NOT EXISTS billing_config jsonb NOT NULL DEFAULT '{
    "appointment_price": 1,
    "minimum_charge": 10,
    "notice_days": 3,
    "grace_days": 7,
    "retry_schedule": [1, 3, 7]
  }'::jsonb;

UPDATE platform_config SET billing_config = '{
    "appointment_price": 1,
    "minimum_charge": 10,
    "notice_days": 3,
    "grace_days": 7,
    "retry_schedule": [1, 3, 7]
  }'::jsonb
WHERE id = 1;

COMMENT ON COLUMN platform_config.billing_config IS
  'Post-paid billing knobs: appointment_price, minimum_charge (rollover floor), '
  'notice_days, grace_days, retry_schedule. Superadmin-editable; enforced in the '
  'DB close job, never the client.';

-- ── 3. billing_periods — one invoice per org per monthly period ────────────────
-- status:  open    — period in progress / not yet closed.
--          pending — closed, amount owed, charge enqueued.
--          charged — charge cleared.
--          failed  — charge attempt failed (dunning, T3.1).
--          waived  — closed with nothing owed this period (zero appts or a
--                    below-floor amount rolled forward), OR a superadmin write-off.
CREATE TABLE billing_periods (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  appointment_count     int  NOT NULL DEFAULT 0 CHECK (appointment_count >= 0),
  -- Charged this period (incl. any incoming rollover). 0 when waived.
  amount_due            numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  -- OUTGOING carry: what this period pushed to the next (below-floor balance).
  amount_rolled_forward numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_rolled_forward >= 0),
  status                text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'pending', 'charged', 'failed', 'waived')),
  charged_at            timestamptz,
  charge_reference      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period_start)
);
CREATE INDEX idx_billing_periods_org ON billing_periods(org_id, period_start DESC);
CREATE INDEX idx_billing_periods_status ON billing_periods(status) WHERE status IN ('pending', 'failed');

ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
-- Owners read their own invoices (the dispute surface); all writes are the close
-- job / charge run (service role) or superadmin — no client write path.
CREATE POLICY billing_periods_select ON billing_periods FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
GRANT SELECT ON billing_periods TO authenticated;

COMMENT ON TABLE billing_periods IS
  'One post-paid invoice per org per monthly period. Written by the close job '
  '(count) and charge run (settle). amount_rolled_forward is the OUTGOING carry '
  'to the next period. Owners have read-only visibility.';

-- ── 4. billing_line_items — immutable ledger: every lari traces to an appointment ─
CREATE TABLE billing_line_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_period_id uuid NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE) so a rare appointment deletion never silently
  -- destroys a financial record; the amount + counted_at survive as audit.
  appointment_id    uuid UNIQUE REFERENCES appointments(id) ON DELETE SET NULL,
  amount            numeric(10,2) NOT NULL CHECK (amount >= 0),
  counted_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_line_items_period ON billing_line_items(billing_period_id);

ALTER TABLE billing_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_line_items_select ON billing_line_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM billing_periods bp
                 WHERE bp.id = billing_period_id
                   AND (bp.org_id = ANY (get_user_org_ids()) OR is_superadmin())));
GRANT SELECT ON billing_line_items TO authenticated;

COMMENT ON TABLE billing_line_items IS
  'Immutable per-appointment ledger backing each invoice. appointment_id UNIQUE '
  'keeps counting idempotent and gives an owner the line-by-line breakdown to '
  'contest a charge. Written only by the close job.';

-- ── 5. org_payment_methods — card on file (token only, NEVER a PAN) ────────────
CREATE TABLE org_payment_methods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  provider    text NOT NULL,                 -- 'mock' for now; 'bog'/'tbc' later
  token       text NOT NULL,                 -- provider card token; NOT a PAN
  last4       text,
  brand       text,
  expires_at  date,                          -- card expiry (first of expiry month)
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'expired', 'removed')),
  is_default  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- At most one default card per org.
CREATE UNIQUE INDEX idx_org_payment_methods_default
  ON org_payment_methods(org_id) WHERE is_default AND status = 'active';

ALTER TABLE org_payment_methods ENABLE ROW LEVEL SECURITY;
-- Owners see their card metadata (last4/brand/expiry); the token is written only
-- by the card-save edge function (service role) — no client write path.
CREATE POLICY org_payment_methods_select ON org_payment_methods FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
GRANT SELECT ON org_payment_methods TO authenticated;

COMMENT ON TABLE org_payment_methods IS
  'Saved card metadata + provider token for post-paid charges. Never stores a '
  'PAN. Written by the card-save edge function; owners read metadata only.';

-- ── 6. Guard billing_status like the other billing fields ──────────────────────
-- Extend prevent_billing_self_update so an owner can't flip their own
-- billing_status (e.g. un-suspend themselves) via a plain PostgREST UPDATE.
-- Only the charge/dunning path (service role, auth.uid() IS NULL), a superadmin,
-- or an internal-billing SECURITY DEFINER routine may change it. (The old
-- tier/credit columns are still guarded here; T1.2 removes them.)
CREATE OR REPLACE FUNCTION prevent_billing_self_update()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.subscription_tier       IS DISTINCT FROM OLD.subscription_tier
   OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
   OR NEW.trial_ends_at           IS DISTINCT FROM OLD.trial_ends_at
   OR NEW.credit_balance          IS DISTINCT FROM OLD.credit_balance
   OR NEW.billing_status          IS DISTINCT FROM OLD.billing_status) THEN
    -- coalesce the GUC: current_setting(..., true) is NULL when unset, and
    -- `NULL = '1'` makes the whole OR-chain NULL, so `IF NOT (…)` would never
    -- fire — a three-valued-logic hole that silently let owners through. Force
    -- the operand to a real boolean.
    IF NOT (auth.uid() IS NULL
         OR is_superadmin()
         OR coalesce(current_setting('app.internal_billing', true), '') = '1') THEN
      RAISE EXCEPTION 'not_authorized: billing fields change only via payment or superadmin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
