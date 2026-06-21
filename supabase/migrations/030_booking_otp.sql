-- ============================================================
-- 030_booking_otp.sql
-- Run AFTER 029_appointment_sms_trigger.sql.
--
-- Phone verification (OTP) for guest bookings. A customer must confirm a code
-- texted to their phone before their appointment can be created. Enforced at
-- the database layer so it can't be bypassed by calling the public insert API
-- directly (appointments INSERT is open to anon — see migration 004).
--
-- Codes are issued/checked by the request-booking-otp / verify-booking-otp
-- edge functions (service role). This migration adds the storage table, the
-- 'verification_code' SMS type, and the BEFORE INSERT gate on appointments.
-- ============================================================

CREATE TABLE booking_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  verified_at timestamptz,
  consumed_at timestamptz
);

COMMENT ON TABLE booking_verifications IS
  'One-time phone-verification challenges for guest bookings. code_hash is '
  'sha256(code:phone:secret). A row is verified by verify-booking-otp and '
  'consumed by the enforce_booking_verification trigger on appointment insert.';

CREATE INDEX idx_booking_verifications_phone
  ON booking_verifications (phone, created_at DESC);

-- All access is via service-role edge functions. Enable RLS with no anon
-- policies; allow superadmin read for auditing only.
ALTER TABLE booking_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "booking_verifications_superadmin_select"
  ON booking_verifications FOR SELECT
  USING (is_superadmin());

-- --------------------------------------------------------
-- Allow the new SMS type in the audit log.
-- --------------------------------------------------------
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation','approval_update',
    'admin_new_booking','admin_reminder','invitation',
    'verification_code'
  ));

-- --------------------------------------------------------
-- Gate: a guest appointment may only be inserted once the customer's phone has
-- a verified, unexpired, unconsumed code. Admin-created appointments (the
-- inserting user is a member of the org) are exempt — mirrors the membership
-- check in notify_new_appointment (migration 021).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_booking_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text;
  v_id    uuid;
BEGIN
  -- Admin of THIS org creating the appointment themselves: no OTP required.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id
      AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT c.phone_number INTO v_phone
    FROM customers c
   WHERE c.id = NEW.customer_id;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'verification_required';
  END IF;

  SELECT bv.id INTO v_id
    FROM booking_verifications bv
   WHERE bv.phone = v_phone
     AND bv.verified_at IS NOT NULL
     AND bv.consumed_at IS NULL
     AND bv.expires_at > now()
   ORDER BY bv.created_at DESC
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'verification_required';
  END IF;

  UPDATE booking_verifications SET consumed_at = now() WHERE id = v_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_booking_verification IS
  'BEFORE INSERT on appointments: requires a verified, unexpired OTP for the '
  'customer phone (guest bookings) and consumes it. Exempts org-member inserts. '
  'Raises ''verification_required''.';

CREATE TRIGGER trg_enforce_booking_verification
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_verification();
