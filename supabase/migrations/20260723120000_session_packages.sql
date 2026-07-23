-- ============================================================
-- 20260723120000_session_packages.sql
-- Run AFTER 20260722130000_service_recurrence_defaults.sql.
--
-- Session packages (abonements) for lesson-based businesses: teachers sell
-- "8 lessons for ₾200" and book a weekly series against it. Deliberately
-- mirrors the credit system (20260722120000_credit_system.sql):
--
--   credit system                      package system
--   ─────────────                      ──────────────
--   organisations.credit_balance   →   customer_packages.sessions_used/total
--   credit_purchases (UNIQUE key)  →   customer_packages (the row IS the sale)
--   credit_consumption (appt UNIQ) →   package_consumption (appt UNIQUE)
--   record_appointment_overage     →   record_package_consumption (parallel)
--   grant_org_credits (webhook)    →   settle_customer_package (webhook)
--
-- The consumption trigger has the SAME shape as record_appointment_overage:
-- AFTER INSERT OR UPDATE OF status ON appointments; consume one session on
-- insert (guarded), refund on transition INTO cancelled/rejected. It is a
-- SEPARATE trigger — credit is org billing, packages are customer prepay.
--
-- Owner/dashboard side only. The guest booking flow is untouched (guests are
-- unauthenticated and have no identity to redeem against): an appointment with
-- customer_package_id IS NULL — every guest booking — early-returns from the
-- trigger.
--
-- Decisions (2026-07-23):
--   * A series that would book more occurrences than the package has sessions
--     is PRE-CHECKED and blocked up front (never trips mid-loop).
--   * packages.service_id is HONORED: a session may only be spent on the
--     package's service (NULL service_id = any service).
-- ============================================================

-- ── 1. Package catalogue (owner-defined; price lives here, never client-sent) ──
CREATE TABLE packages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  service_id    uuid REFERENCES services(id) ON DELETE CASCADE,   -- NULL = any service
  name          text NOT NULL,
  session_count int  NOT NULL CHECK (session_count > 0),
  price         numeric(10,2) NOT NULL CHECK (price >= 0),
  validity_days int  CHECK (validity_days IS NULL OR validity_days > 0), -- NULL = no expiry
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_packages_org ON packages(org_id) WHERE active;

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY packages_select ON packages FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
-- Owner CRUD on the catalogue is safe via PostgREST (no billing/credit risk).
-- Writes to customer_packages / package_consumption are trigger/edge-only, like
-- the credit ledgers.
CREATE POLICY packages_write ON packages FOR ALL
  USING (org_id = ANY (get_user_org_ids()))
  WITH CHECK (org_id = ANY (get_user_org_ids()));
GRANT SELECT, INSERT, UPDATE, DELETE ON packages TO authenticated;

COMMENT ON TABLE packages IS
  'Owner-defined session package catalogue (e.g. "8 lessons — ₾200"). '
  'service_id NULL = redeemable against any service; validity_days NULL = no '
  'expiry. Price is read server-side by create-payment, never client-sent.';

-- ── 2. Sold packages (one row per sale; the row IS the purchase, cf credit_purchases) ─
CREATE TABLE customer_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  package_id      uuid NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  -- Snapshot of session_count at sale time, so editing the catalogue later never
  -- rewrites a sold package's entitlement.
  sessions_total  int  NOT NULL CHECK (sessions_total > 0),
  sessions_used   int  NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  purchased_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,                       -- NULL = no expiry
  payment_status  text NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending','paid','failed')),
  -- Checkout provider + reference, matched by payment-webhook on settle
  -- (mirrors credit_purchases).
  payment_provider  text,
  payment_reference text,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (sessions_used <= sessions_total),
  UNIQUE (org_id, idempotency_key)
);
CREATE INDEX idx_customer_packages_cust ON customer_packages(customer_id) WHERE payment_status = 'paid';
CREATE INDEX idx_customer_packages_org  ON customer_packages(org_id, created_at DESC);

ALTER TABLE customer_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_packages_select ON customer_packages FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());
GRANT SELECT ON customer_packages TO authenticated;  -- writes via edge/trigger only

COMMENT ON TABLE customer_packages IS
  'A package sold to a customer. sessions_used is moved only by '
  'record_package_consumption (consume/refund) and settle_customer_package '
  '(webhook flips payment_status). No client write path.';

-- ── 3. Consumption ledger (which appointment spent a session) ──────────────────
-- Exact analogue of credit_consumption: appointment_id UNIQUE keeps consume
-- idempotent and gives a later cancel/reject a row to refund against.
CREATE TABLE package_consumption (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_package_id uuid NOT NULL REFERENCES customer_packages(id) ON DELETE CASCADE,
  appointment_id      uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_package_consumption_cp ON package_consumption(customer_package_id);

ALTER TABLE package_consumption ENABLE ROW LEVEL SECURITY;
CREATE POLICY package_consumption_select ON package_consumption FOR SELECT
  USING (EXISTS (SELECT 1 FROM customer_packages cp
                 WHERE cp.id = customer_package_id
                   AND (cp.org_id = ANY (get_user_org_ids()) OR is_superadmin())));
GRANT SELECT ON package_consumption TO authenticated;

-- ── 4. The appointment→package link (mirrors series_id added in 095) ───────────
ALTER TABLE appointments
  ADD COLUMN customer_package_id uuid REFERENCES customer_packages(id) ON DELETE SET NULL;
CREATE INDEX idx_appointments_customer_package
  ON appointments(customer_package_id) WHERE customer_package_id IS NOT NULL;

COMMENT ON COLUMN appointments.customer_package_id IS
  'Set when this appointment redeems a customer_packages session. Drives '
  'record_package_consumption. NULL for every guest booking and any '
  'pay-as-you-go appointment.';

-- ── 5. Consume / refund a session — same shape as record_appointment_overage ───
--   INSERT: an appointment carrying a customer_package_id consumes one session,
--     under a row lock (FOR UPDATE) so concurrent inserts can't over-consume.
--     Guards raise clear errors (not_paid / expired / service_mismatch /
--     exhausted) that roll the insert back — mirrors credit's 'limit_reached'.
--   UPDATE→cancelled/rejected: refund the session it consumed.
-- SECURITY DEFINER so it can write customer_packages past that table's
-- (SELECT-only) grants; customer_packages has no billing-self-update guard, so
-- no app.internal_billing flag is needed.
CREATE OR REPLACE FUNCTION record_package_consumption()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total   int;
  v_used    int;
  v_status  text;
  v_expires timestamptz;
  v_pkg_svc uuid;
BEGIN
  IF NEW.customer_package_id IS NULL THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('rejected', 'cancelled')
       AND OLD.status NOT IN ('rejected', 'cancelled') THEN
      IF EXISTS (SELECT 1 FROM package_consumption WHERE appointment_id = NEW.id) THEN
        DELETE FROM package_consumption WHERE appointment_id = NEW.id;
        UPDATE customer_packages
           SET sessions_used = sessions_used - 1
         WHERE id = NEW.customer_package_id;
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  -- INSERT path. A row landing already cancelled/rejected never consumes.
  IF NEW.status IN ('rejected', 'cancelled') THEN RETURN NULL; END IF;

  -- Lock the sold-package row so two concurrent inserts serialize on it (the
  -- race guard, cf credit's `WHERE credit_balance > 0`).
  SELECT cp.sessions_total, cp.sessions_used, cp.payment_status, cp.expires_at, p.service_id
    INTO v_total, v_used, v_status, v_expires, v_pkg_svc
    FROM customer_packages cp
    JOIN packages p ON p.id = cp.package_id
   WHERE cp.id = NEW.customer_package_id
   FOR UPDATE OF cp;

  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF v_status <> 'paid' THEN RAISE EXCEPTION 'package_not_paid'; END IF;
  IF v_expires IS NOT NULL AND v_expires <= now() THEN RAISE EXCEPTION 'package_expired'; END IF;
  IF v_pkg_svc IS NOT NULL AND v_pkg_svc <> NEW.service_id THEN
    RAISE EXCEPTION 'package_service_mismatch'
      USING HINT = 'this package is not valid for the chosen service';
  END IF;
  IF v_used >= v_total THEN
    RAISE EXCEPTION 'package_exhausted'
      USING HINT = 'no sessions remaining on this package';
  END IF;

  UPDATE customer_packages SET sessions_used = sessions_used + 1
   WHERE id = NEW.customer_package_id;

  INSERT INTO package_consumption (customer_package_id, appointment_id)
  VALUES (NEW.customer_package_id, NEW.id)
  ON CONFLICT (appointment_id) DO NOTHING;

  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_record_package_consumption
  AFTER INSERT OR UPDATE OF status ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION record_package_consumption();

-- Fires as the table owner; no direct EXECUTE needed. Revoke the default PUBLIC
-- grant so it isn't callable as a bare RPC (matches the 073/088 lockdown).
REVOKE ALL ON FUNCTION record_package_consumption() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION record_package_consumption IS
  'AFTER INSERT/UPDATE on appointments: consumes one customer_packages session '
  'for an appointment carrying customer_package_id (guarded: paid, not expired, '
  'service match, sessions left), and refunds it on cancel/reject. Same shape '
  'as record_appointment_overage; owner-side only (guest rows have NULL link).';

-- ── 6. Webhook settle path — analogue of grant_org_credits ─────────────────────
-- Flip a pending sold package to paid when its charge clears, stamping expiry
-- from the catalogue's validity_days AT SETTLE TIME (so the clock starts when
-- the customer paid, not when the intent was parked). Service-role only (the
-- payment-webhook); idempotent via the pending guard.
CREATE OR REPLACE FUNCTION settle_customer_package(p_id uuid)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text;
BEGIN
  UPDATE customer_packages cp
     SET payment_status = 'paid',
         expires_at = CASE WHEN p.validity_days IS NULL THEN NULL
                           ELSE now() + make_interval(days => p.validity_days) END
    FROM packages p
   WHERE cp.id = p_id AND cp.package_id = p.id AND cp.payment_status = 'pending'
  RETURNING cp.payment_status INTO v_status;
  RETURN v_status;  -- NULL when nothing pending (already settled / not found)
END;
$function$;
REVOKE EXECUTE ON FUNCTION settle_customer_package(uuid) FROM public, anon, authenticated;

-- ── 7. Allow the 'package' purpose in the payment_log audit trail ──────────────
ALTER TABLE payment_log DROP CONSTRAINT IF EXISTS payment_log_purpose_check;
ALTER TABLE payment_log ADD CONSTRAINT payment_log_purpose_check
  CHECK (purpose = ANY (ARRAY['appointment','subscription','stay','credit','package']));

-- ── 8. Extend create_recurrence_series with an optional package to redeem ──────
-- The canonical flow "sell 8 sessions, book an 8-occurrence weekly series" needs
-- the series to redeem an EXISTING customer's package rather than mint a new
-- customer (the base function always inserts a fresh customer). When
-- p_customer_package_id is passed:
--   * the series is booked for the package's customer (p_first_name/last_name/
--     phone are ignored),
--   * end_type must be 'count' (bounded redemption),
--   * the package must be paid, unexpired, service-compatible, and have at least
--     p_occurrence_count sessions remaining (PRE-CHECK — blocks up front so the
--     consumption trigger never trips mid-loop; skipped collisions just consume
--     fewer),
--   * every generated occurrence carries customer_package_id, so the trigger
--     decrements per made occurrence.
-- Signature changes (added trailing param), so DROP + recreate.
DROP FUNCTION IF EXISTS create_recurrence_series(uuid, uuid, uuid, text, text, text, timestamptz, text, text, int, date, text);

CREATE OR REPLACE FUNCTION create_recurrence_series(
  p_org_id              uuid,
  p_service_id          uuid,
  p_staff_id            uuid,
  p_first_name          text,
  p_last_name           text,
  p_phone               text,
  p_start_at            timestamptz,
  p_cadence             text,
  p_end_type            text,
  p_occurrence_count    int  DEFAULT NULL,
  p_until_date          date DEFAULT NULL,
  p_notes               text DEFAULT NULL,
  p_customer_package_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  MAX_OCC  constant int := 52;
  v_dur      int;
  v_customer uuid;
  v_series   uuid;
  v_occ      timestamptz;
  v_end      timestamptz;
  v_cap      int;
  v_overlaps int;
  v_made     int := 0;
  v_skipped  int := 0;
  v_steps    int := 0;
  -- Package redemption context.
  v_pkg_total   int;
  v_pkg_used    int;
  v_pkg_status  text;
  v_pkg_expires timestamptz;
  v_pkg_svc     uuid;
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_cadence  NOT IN ('weekly', 'biweekly', 'monthly') THEN RAISE EXCEPTION 'invalid_cadence'; END IF;
  IF p_end_type NOT IN ('count', 'until') THEN RAISE EXCEPTION 'invalid_end'; END IF;
  IF p_end_type = 'count' AND NOT (coalesce(p_occurrence_count, 0) BETWEEN 1 AND MAX_OCC) THEN RAISE EXCEPTION 'invalid_count'; END IF;
  IF p_end_type = 'until' AND p_until_date IS NULL THEN RAISE EXCEPTION 'invalid_until'; END IF;

  SELECT duration_minutes INTO v_dur FROM services WHERE id = p_service_id AND org_id = p_org_id AND is_active;
  IF v_dur IS NULL THEN RAISE EXCEPTION 'service_not_found'; END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_members m
      JOIN service_staff ss ON ss.member_id = m.id AND ss.service_id = p_service_id
     WHERE m.id = p_staff_id AND m.org_id = p_org_id AND m.is_bookable
  ) THEN RAISE EXCEPTION 'staff_not_available'; END IF;

  -- Package redemption: validate + PRE-CHECK sufficiency up front, and reuse the
  -- package's customer instead of creating a new one.
  IF p_customer_package_id IS NOT NULL THEN
    IF p_end_type <> 'count' THEN RAISE EXCEPTION 'package_requires_count'; END IF;

    SELECT cp.customer_id, cp.sessions_total, cp.sessions_used, cp.payment_status,
           cp.expires_at, p.service_id
      INTO v_customer, v_pkg_total, v_pkg_used, v_pkg_status, v_pkg_expires, v_pkg_svc
      FROM customer_packages cp
      JOIN packages p ON p.id = cp.package_id
     WHERE cp.id = p_customer_package_id AND cp.org_id = p_org_id
     FOR UPDATE OF cp;

    IF v_customer IS NULL THEN RAISE EXCEPTION 'package_not_found'; END IF;
    IF v_pkg_status <> 'paid' THEN RAISE EXCEPTION 'package_not_paid'; END IF;
    IF v_pkg_expires IS NOT NULL AND v_pkg_expires <= now() THEN RAISE EXCEPTION 'package_expired'; END IF;
    IF v_pkg_svc IS NOT NULL AND v_pkg_svc <> p_service_id THEN RAISE EXCEPTION 'package_service_mismatch'; END IF;
    IF (v_pkg_total - v_pkg_used) < p_occurrence_count THEN RAISE EXCEPTION 'package_insufficient_sessions'; END IF;
  ELSE
    INSERT INTO customers (first_name, last_name, phone_number)
    VALUES (trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''), p_phone)
    RETURNING id INTO v_customer;
  END IF;

  INSERT INTO recurrence_series (org_id, customer_id, service_id, staff_id, cadence, start_at,
                                 duration_minutes, end_type, occurrence_count, until_date)
  VALUES (p_org_id, v_customer, p_service_id, p_staff_id, p_cadence, p_start_at, v_dur,
          p_end_type, p_occurrence_count, p_until_date)
  RETURNING id INTO v_series;

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text));
  SELECT max_per_slot INTO v_cap FROM services WHERE id = p_service_id;

  v_occ := p_start_at;
  LOOP
    EXIT WHEN v_steps >= MAX_OCC;
    IF p_end_type = 'count' AND v_steps >= p_occurrence_count THEN EXIT; END IF;
    IF p_end_type = 'until' AND (v_occ AT TIME ZONE 'Asia/Tbilisi')::date > p_until_date THEN EXIT; END IF;

    v_end := v_occ + make_interval(mins => v_dur);

    SELECT count(*) INTO v_overlaps
      FROM appointments a
     WHERE a.org_id = p_org_id AND a.service_id = p_service_id
       AND a.status NOT IN ('rejected', 'cancelled')
       AND a.scheduled_at > v_occ - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_occ;

    IF v_overlaps >= coalesce(v_cap, 1)
       OR (p_staff_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.org_id = p_org_id AND a.staff_id = p_staff_id
               AND a.status NOT IN ('rejected', 'cancelled')
               AND a.scheduled_at > v_occ - interval '1 day'
               AND a.scheduled_at < v_end
               AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_occ)) THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at, duration_minutes,
                                staff_id, status, payment_method, payment_status, notes, series_id,
                                customer_package_id)
      VALUES (p_org_id, p_service_id, v_customer, v_occ, v_dur, p_staff_id,
              'approved', 'in_person', 'unpaid', p_notes, v_series, p_customer_package_id);
      v_made := v_made + 1;
    END IF;

    v_steps := v_steps + 1;
    v_occ := CASE p_cadence
               WHEN 'weekly'   THEN v_occ + interval '7 days'
               WHEN 'biweekly' THEN v_occ + interval '14 days'
               ELSE                 v_occ + interval '1 month'
             END;
  END LOOP;

  RETURN jsonb_build_object('series_id', v_series, 'made', v_made, 'skipped', v_skipped);
END;
$$;

COMMENT ON FUNCTION create_recurrence_series IS
  'Owner writer: creates a recurring series + its (bounded, capped-52) '
  'occurrences, skipping slots that collide. When p_customer_package_id is set, '
  'redeems that package (count-based, pre-checked for sufficiency) and books for '
  'its customer. Returns {series_id, made, skipped}.';
REVOKE ALL ON FUNCTION create_recurrence_series(uuid, uuid, uuid, text, text, text, timestamptz, text, text, int, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_recurrence_series(uuid, uuid, uuid, text, text, text, timestamptz, text, text, int, date, text, uuid) TO authenticated;

-- ── 9. Owner read of sold packages with the customer's name ────────────────────
-- customers_select (004) only exposes customers who already have an appointment
-- in the org, so a freshly-sold, not-yet-booked package's customer would be
-- invisible to a plain embed. This SECURITY DEFINER RPC returns the org's sold
-- packages joined to customer + catalogue for the sold-packages list and the
-- add-appointment redemption picker.
CREATE OR REPLACE FUNCTION get_org_customer_packages(p_org_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT cp.id, cp.customer_id, cp.sessions_total, cp.sessions_used,
           cp.expires_at, cp.payment_status, cp.created_at,
           c.first_name, c.last_name, c.phone_number,
           p.name AS package_name, p.service_id
      FROM customer_packages cp
      JOIN customers c ON c.id = cp.customer_id
      JOIN packages   p ON p.id = cp.package_id
     WHERE cp.org_id = p_org_id
  ) t;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION get_org_customer_packages(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_org_customer_packages(uuid) TO authenticated;
