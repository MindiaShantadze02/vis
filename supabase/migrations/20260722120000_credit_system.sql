-- Credit system — purchasable booking credit with a HARD CAP for active orgs.
--
-- Product decision (2026-07-22): the previous model metered over-allowance
-- bookings into overage_events but never blocked (only an EXPIRED subscription
-- blocked). We now enforce a hard cap for ACTIVE (paid) orgs: once the included
-- monthly allowance is used, further bookings require purchased credit. Each
-- over-allowance booking consumes one credit; with no credit the booking is
-- blocked (limit_reached). Trials keep their SOFT allowance (never blocked, no
-- credit consumed); expired orgs stay fully blocked.
--
-- Credit is bought in-app (create-payment purpose 'credit' → payment-webhook
-- grants it). Purchase safety (no multi-request card charging) lives in the
-- edge functions: auth-gated, server-defined pack prices, and an idempotency
-- key enforced by the UNIQUE constraint below.

-- ── 1. Balance column on organisations ────────────────────────────────────────
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS credit_balance int NOT NULL DEFAULT 0
  CHECK (credit_balance >= 0);

-- ── 2. Purchase ledger (audit of bought packs) ────────────────────────────────
-- Mirrors subscription_payments. The UNIQUE (org_id, idempotency_key) is the
-- replay guard: a resubmitted purchase request reuses its row instead of
-- creating a second charge.
CREATE TABLE IF NOT EXISTS credit_purchases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  credits           int  NOT NULL CHECK (credits > 0),
  amount            numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency          text NOT NULL DEFAULT 'GEL',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  payment_provider  text,
  payment_reference text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_org ON credit_purchases(org_id, created_at DESC);

ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
-- Read-only for org members / superadmin; all writes go through the service-role
-- edge functions (create-payment / payment-webhook), which bypass RLS.
DROP POLICY IF EXISTS credit_purchases_select ON credit_purchases;
CREATE POLICY credit_purchases_select ON credit_purchases FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
GRANT SELECT ON credit_purchases TO authenticated;

-- ── 3. Consumption ledger (which appointment spent a credit) ───────────────────
-- One row per over-allowance appointment, so a later cancel/reject can refund
-- the credit. appointment_id UNIQUE keeps consumption idempotent.
CREATE TABLE IF NOT EXISTS credit_consumption (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  period_start   date NOT NULL DEFAULT current_date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_consumption_org_period ON credit_consumption(org_id, period_start);

ALTER TABLE credit_consumption ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_consumption_select ON credit_consumption;
CREATE POLICY credit_consumption_select ON credit_consumption FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
GRANT SELECT ON credit_consumption TO authenticated;

-- ── 4. Server-defined credit packs (price lives here, never on the client) ─────
ALTER TABLE platform_config
  ADD COLUMN IF NOT EXISTS credit_packs jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE platform_config SET credit_packs = '[
  {"id":"pack_20",  "credits":20,  "price":6},
  {"id":"pack_50",  "credits":50,  "price":14},
  {"id":"pack_100", "credits":100, "price":25}
]'::jsonb
WHERE id = 1;

-- Public-ish read of the pack catalogue for the buy-credits UI (authenticated
-- org members only; anon has no business buying credit).
CREATE OR REPLACE FUNCTION get_credit_packs()
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE(credit_packs, '[]'::jsonb) FROM platform_config WHERE id = 1 $$;
REVOKE EXECUTE ON FUNCTION get_credit_packs() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_credit_packs() TO authenticated;

-- ── 5. Protect credit_balance like the other billing fields ────────────────────
-- Owners must not be able to grant themselves credit via a plain PostgREST
-- UPDATE. Only the payment path (service role, auth.uid() IS NULL), a superadmin,
-- or our SECURITY DEFINER credit trigger (which sets app.internal_billing) may
-- change credit_balance.
CREATE OR REPLACE FUNCTION prevent_billing_self_update()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (NEW.subscription_tier       IS DISTINCT FROM OLD.subscription_tier
   OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
   OR NEW.trial_ends_at           IS DISTINCT FROM OLD.trial_ends_at
   OR NEW.credit_balance          IS DISTINCT FROM OLD.credit_balance) THEN
    IF NOT (auth.uid() IS NULL
         OR is_superadmin()
         OR current_setting('app.internal_billing', true) = '1') THEN
      RAISE EXCEPTION 'not_authorized: billing fields change only via payment or superadmin';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 6. Acceptance check now accounts for the hard cap + credits ────────────────
-- expired  → never;  trial → always (soft allowance);  unlimited tier → always;
-- active & under included → free;  active & at/over included → only with credit.
-- Used by enforce_appointment_limit (BEFORE INSERT) and the create-payment
-- pre-check, so a blocked org is rejected before any charge starts.
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN st.state = 'expired'              THEN false
    WHEN st.state = 'trial'                THEN true
    WHEN st.included IS NULL               THEN true
    WHEN org_usage(p_org_id) < st.included THEN true
    ELSE st.credit_balance > 0
  END
  FROM (
    SELECT org_subscription_state(p_org_id)             AS state,
           (pc.tier_limits ->> o.subscription_tier)::int AS included,
           o.credit_balance                             AS credit_balance
    FROM organisations o CROSS JOIN platform_config pc
    WHERE o.id = p_org_id AND pc.id = 1
  ) st;
$function$;

-- ── 7. Credit consumption / refund on the appointment trigger ──────────────────
-- Replaces the old overage-metering body. Still fires AFTER INSERT OR UPDATE OF
-- status ON appointments (trigger binding unchanged).
--   INSERT: an active org's booking beyond the included allowance atomically
--     consumes one credit (UPDATE ... WHERE credit_balance > 0 is the race guard);
--     no credit left → raise limit_reached to roll the insert back.
--   UPDATE→cancelled/rejected: refund the credit the appointment consumed.
-- Trials/expired/unlimited never consume. overage_events is left in place but no
-- longer written (kept for historical rows; get_org_entitlements still reads it).
CREATE OR REPLACE FUNCTION record_appointment_overage()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_anchor   timestamptz;
  v_included int;
BEGIN
  -- Allow this trigger's credit_balance writes past prevent_billing_self_update
  -- even when the appointment was created by an authenticated owner.
  PERFORM set_config('app.internal_billing', '1', true);

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('rejected', 'cancelled')
       AND OLD.status NOT IN ('rejected', 'cancelled') THEN
      IF EXISTS (SELECT 1 FROM credit_consumption WHERE appointment_id = NEW.id) THEN
        DELETE FROM credit_consumption WHERE appointment_id = NEW.id;
        UPDATE organisations SET credit_balance = credit_balance + 1 WHERE id = NEW.org_id;
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  -- INSERT path.
  IF NEW.status IN ('rejected', 'cancelled') THEN RETURN NULL; END IF;
  -- Trial = soft allowance, expired is blocked upstream: only active orgs meter.
  IF org_subscription_state(NEW.org_id) <> 'active' THEN RETURN NULL; END IF;

  SELECT o.usage_anchor, (pc.tier_limits ->> o.subscription_tier)::int
    INTO v_anchor, v_included
    FROM organisations o CROSS JOIN platform_config pc
    WHERE o.id = NEW.org_id AND pc.id = 1;

  IF v_included IS NULL THEN RETURN NULL; END IF;  -- unlimited tier

  -- After insert org_usage includes NEW; > included means this booking is over
  -- the free allowance and must be paid for with a credit.
  IF org_usage(NEW.org_id) > v_included THEN
    UPDATE organisations
       SET credit_balance = credit_balance - 1
     WHERE id = NEW.org_id AND credit_balance > 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'limit_reached'
        USING HINT = 'included allowance used; purchase credit to keep booking';
    END IF;
    INSERT INTO credit_consumption (org_id, appointment_id, period_start)
    VALUES (NEW.org_id, NEW.id, current_period_start(v_anchor)::date)
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$function$;

-- ── 8. Surface credit balance + usage in the entitlements RPC ──────────────────
CREATE OR REPLACE FUNCTION get_org_entitlements(p_org_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result        jsonb;
  v_period_start  timestamptz;
  v_overage_cnt   int;
  v_overage_price numeric(10,2);
  v_credit_used   int;
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

  SELECT count(*)::int INTO v_credit_used
    FROM credit_consumption
   WHERE org_id = p_org_id AND period_start = v_period_start::date;

  SELECT jsonb_build_object(
           'tier',           o.subscription_tier,
           'state',          org_subscription_state(o.id),
           'included',       (pc.tier_limits ->> o.subscription_tier)::int,
           'used',           org_usage(o.id),
           'overage_price',  v_overage_price,
           'overage_count',  v_overage_cnt,
           'overage_cost',   round(v_overage_cnt * COALESCE(v_overage_price, 0), 2),
           'credit_balance', o.credit_balance,
           'credit_used',    v_credit_used,
           'seat_used',      (SELECT count(*)::int FROM org_members m
                               WHERE m.org_id = o.id AND m.is_bookable),
           'seat_limit',     (pc.tier_staff_limits ->> o.subscription_tier)::int,
           'period_start',   v_period_start,
           'period_end',     v_period_start + interval '1 month',
           'trial_ends_at',  o.trial_ends_at,
           'features',       COALESCE(pc.tier_features -> o.subscription_tier, '{}'::jsonb)
         )
    INTO v_result
    FROM organisations o
    CROSS JOIN platform_config pc
   WHERE o.id = p_org_id AND pc.id = 1;

  RETURN v_result;
END;
$function$;

-- ── 9. Allow the credit purpose in the payment_log audit trail ─────────────────
ALTER TABLE payment_log DROP CONSTRAINT IF EXISTS payment_log_purpose_check;
ALTER TABLE payment_log ADD CONSTRAINT payment_log_purpose_check
  CHECK (purpose = ANY (ARRAY['appointment','subscription','stay','credit']));

-- ── 10. Atomic credit grant (payment-webhook settle path) ──────────────────────
-- One-statement increment so two purchases settling for the same org can't lose
-- an update. Service-role only (the webhook); sets the internal-billing flag so
-- prevent_billing_self_update permits the credit_balance change.
CREATE OR REPLACE FUNCTION grant_org_credits(p_org_id uuid, p_delta int)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bal int;
BEGIN
  IF p_delta <= 0 THEN RAISE EXCEPTION 'invalid_delta'; END IF;
  PERFORM set_config('app.internal_billing', '1', true);
  UPDATE organisations SET credit_balance = credit_balance + p_delta
   WHERE id = p_org_id
  RETURNING credit_balance INTO v_bal;
  RETURN v_bal;
END;
$function$;
REVOKE EXECUTE ON FUNCTION grant_org_credits(uuid, int) FROM public, anon, authenticated;
