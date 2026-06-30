-- ============================================================
-- 053_hotel_prepay.sql
-- Run AFTER 052_reservation_turn_minutes.sql.
--
-- Hotel full-prepayment support. When a hotel has online payment enabled, a
-- guest pays the FULL stay up front; the stay is created only after the charge
-- clears (mirrors the appointment online flow: create-payment parks an intent
-- here, payment-webhook promotes it to hotel_stays). Pay-at-desk (no online
-- payment) is unchanged — that path still inserts hotel_stays directly.
--
-- ADDITIVE: appointments and the existing stay flow are untouched.
-- ============================================================

-- Payment columns on hotel_stays, mirroring appointments (001/032).
ALTER TABLE hotel_stays
  ADD COLUMN payment_status   text NOT NULL DEFAULT 'unpaid'
                                CHECK (payment_status IN ('unpaid','paid','refunded')),
  ADD COLUMN payment_method   text CHECK (payment_method IN ('online','in_person')),
  ADD COLUMN payment_provider text,
  ADD COLUMN payment_reference text;

COMMENT ON COLUMN hotel_stays.payment_status IS
  'unpaid (pay at desk) | paid (online prepay cleared) | refunded.';

-- Parked online-stay details awaiting payment. Promoted to a real hotel_stays
-- row by payment-webhook on success; marked failed otherwise. Written/read only
-- by the payment edge functions via the service role. Mirrors pending_bookings (033).
CREATE TABLE pending_stays (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','consumed','failed')),
  org_id            uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  room_type_id      uuid REFERENCES resources(id) ON DELETE SET NULL,
  check_in          date NOT NULL,
  check_out         date NOT NULL,
  guests            int2 NOT NULL,
  nightly_rate      numeric(10,2) NOT NULL,
  first_name        text NOT NULL,
  last_name         text,
  phone             text NOT NULL,
  notes             text,
  amount            numeric(10,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'GEL',
  payment_provider  text,
  payment_reference text,
  CONSTRAINT pending_stays_range_chk CHECK (check_out > check_in)
);

COMMENT ON TABLE pending_stays IS
  'Parked online hotel-stay details awaiting payment. Promoted to hotel_stays by '
  'payment-webhook on success; marked failed otherwise. Service-role only.';

CREATE INDEX pending_stays_reference_idx ON pending_stays(payment_reference);

ALTER TABLE pending_stays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_stays_superadmin_select"
  ON pending_stays FOR SELECT
  USING (is_superadmin());

-- Allow the new payment purpose in the audit log (032 had appointment|subscription).
ALTER TABLE payment_log DROP CONSTRAINT IF EXISTS payment_log_purpose_check;
ALTER TABLE payment_log ADD CONSTRAINT payment_log_purpose_check
  CHECK (purpose IN ('appointment','subscription','stay'));
