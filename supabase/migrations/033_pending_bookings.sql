-- ============================================================
-- 033_pending_bookings.sql
-- Run AFTER 032_payments.sql.
--
-- For online (pay-now) bookings we must NOT create an appointment until the
-- payment actually clears — a failed or abandoned payment should leave nothing
-- on the business's dashboard. So the booking details are parked here as an
-- "intent" by create-payment, and the real customer + appointment rows are
-- created by payment-webhook only on a successful charge. On failure the intent
-- is marked 'failed' and no appointment is ever created.
--
-- In-person bookings are unaffected: they still insert the appointment directly
-- (no payment step).
-- ============================================================

CREATE TABLE pending_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','consumed','failed')),
  org_id            uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  service_id        uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  scheduled_at      timestamptz NOT NULL,
  duration_minutes  int2 NOT NULL,
  -- Matches appointments.staff_id (the assigned member, or null for "any").
  staff_id          uuid REFERENCES org_members(id) ON DELETE SET NULL,
  first_name        text NOT NULL,
  last_name         text,
  phone             text NOT NULL,
  notes             text,
  amount            numeric(10,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'GEL',
  payment_provider  text,
  payment_reference text
);

COMMENT ON TABLE pending_bookings IS
  'Parked online-booking details awaiting payment. Promoted to a real '
  'appointment by payment-webhook on success; marked failed otherwise. '
  'Written/read only by the payment edge functions via the service role.';

CREATE INDEX pending_bookings_reference_idx ON pending_bookings(payment_reference);

-- All access is via service-role edge functions; superadmin read for auditing.
ALTER TABLE pending_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_bookings_superadmin_select"
  ON pending_bookings FOR SELECT
  USING (is_superadmin());
