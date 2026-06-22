-- ============================================================
-- 032_payments.sql
-- Run AFTER 031_approval_sms.sql.
--
-- Adds the pieces a pluggable PAYMENT provider needs, mirroring the SMS
-- setup (platform_config.sms_provider / sms_config, sms_log audit table).
-- Money moves in two flows:
--   * appointment  — a customer pays the business for an online booking
--   * subscription — a business pays Grafiki to upgrade its tier
-- Both are driven by the create-payment / payment-webhook edge functions
-- through a provider abstraction (mock for now; bog/tbc drop in later).
--
-- No new ledger table is needed for the flows themselves: the appointment
-- row and the subscription_payments row each hold their gateway session id
-- in their existing payment_reference column. payment_log below is a thin
-- audit trail (like sms_log) recording every attempt for reconciliation.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Allow the 'mock' provider (and keep room for the real ones).
--    Inline CHECKs get the conventional <table>_<column>_check name.
-- ------------------------------------------------------------
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_payment_provider_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_payment_provider_check
  CHECK (payment_provider IN ('bog','tbc','mock'));

ALTER TABLE subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_payment_provider_check;
ALTER TABLE subscription_payments
  ADD CONSTRAINT subscription_payments_payment_provider_check
  CHECK (payment_provider IN ('bog','tbc','mock'));

-- ------------------------------------------------------------
-- 2. Platform-level payment config, mirroring sms_provider / sms_config.
--    payment_provider: active gateway name ('mock', 'bog', 'tbc').
--    payment_config:   provider-agnostic settings/secrets, e.g.
--      { "webhook_secret": "<shared secret, also set as PAYMENT_WEBHOOK_SECRET>" }
--    When payment_provider is NULL the edge functions default to 'mock'.
-- ------------------------------------------------------------
ALTER TABLE platform_config
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_config   jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_config.payment_provider IS
  'Active payment gateway: mock | bog | tbc. NULL => mock. Mirrors sms_provider.';

-- ------------------------------------------------------------
-- 3. payment_log — audit trail of every payment attempt (mirrors sms_log).
--    All writes go through the service role in the payment edge functions;
--    end users never insert here. Superadmin can read for reconciliation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_log (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  org_id                  uuid REFERENCES organisations(id) ON DELETE CASCADE,
  purpose                 text NOT NULL CHECK (purpose IN ('appointment','subscription')),
  appointment_id          uuid REFERENCES appointments(id) ON DELETE SET NULL,
  subscription_payment_id uuid REFERENCES subscription_payments(id) ON DELETE SET NULL,
  amount                  numeric(10,2) NOT NULL,
  currency                text NOT NULL DEFAULT 'GEL',
  provider                text NOT NULL,
  provider_reference      text,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','paid','failed')),
  error                   text
);

COMMENT ON TABLE payment_log IS
  'Audit trail of payment attempts across both flows (appointment + subscription). '
  'Written by the create-payment / payment-webhook edge functions via the service role.';

CREATE INDEX IF NOT EXISTS payment_log_org_idx        ON payment_log(org_id);
CREATE INDEX IF NOT EXISTS payment_log_reference_idx  ON payment_log(provider_reference);
CREATE INDEX IF NOT EXISTS payment_log_created_at_idx ON payment_log(created_at DESC);

ALTER TABLE payment_log ENABLE ROW LEVEL SECURITY;

-- Superadmin read-only; all inserts/updates via service role in Edge Functions.
CREATE POLICY "payment_log_superadmin_select"
  ON payment_log FOR SELECT
  USING (is_superadmin());
