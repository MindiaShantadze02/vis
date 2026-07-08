-- ============================================================
-- 069_appointment_insert_hardening.sql
-- Run AFTER 068_reviews.sql.
--
-- Security fix: the appointments INSERT policy is WITH CHECK (true) (migration
-- 004) with no column-level restriction and no value normalisation. The three
-- existing BEFORE INSERT guards (OTP, advance-window, tier-limit) only gate
-- WHETHER a row may be inserted, never its VALUES. So a hand-crafted anon/public
-- call (after passing OTP for a phone the caller controls) could set privileged
-- fields the booking form never exposes:
--
--   * status = 'approved' / 'completed'  → skip the business's approval workflow;
--                                          'completed' also unlocks submit_review()
--                                          → review-bombing ANY org (audit #1/#2).
--   * payment_status = 'paid' + payment_method = 'online'
--                                        → appears paid without paying (fraud).
--   * payment_provider / payment_reference / admin_notes → arbitrary injection.
--
-- Fix: a BEFORE INSERT trigger that PINS these security-sensitive fields to safe
-- defaults for untrusted (guest) inserts, while leaving trusted contexts free to
-- set them:
--   * the service role   — payment-webhook fulfilling a paid online booking
--                          (status='approved', payment_status='paid');
--   * a superadmin;
--   * a member of NEW.org_id — admin manual entry (AddAppointmentDialog), which
--                          legitimately creates already-'approved' rows.
--
-- A guest booking already sends exactly these safe values, so this is a no-op for
-- the real client and closes the tampering path for a crafted one.
--
-- Note (audit #4, quota-exhaustion DoS via arbitrary org_id): NOT addressed here.
-- Public booking must target any org by design, and each guest insert already
-- requires its own verified OTP (enforce_booking_verification), which the 60s
-- per-phone request cooldown rate-limits. Left as accepted residual risk.
-- ============================================================

CREATE OR REPLACE FUNCTION normalize_guest_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Trusted contexts may set privileged fields directly.
  --   auth.role() = 'service_role'  → payment-webhook (online fulfilment)
  --   is_superadmin()               → platform admin
  --   member of NEW.org_id          → dashboard admin manual entry
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  -- Untrusted (guest) insert: pin the security-sensitive fields. A direct guest
  -- booking is always in-person + pending + unpaid; online bookings are created
  -- only by the service-role webhook (exempt above), never by the public client.
  NEW.status            := 'pending';
  NEW.payment_status    := 'unpaid';
  NEW.payment_method    := 'in_person';
  NEW.payment_provider  := NULL;
  NEW.payment_reference := NULL;
  NEW.admin_notes       := NULL;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION normalize_guest_appointment IS
  'BEFORE INSERT on appointments: pins status/payment_*/admin_notes to safe '
  'defaults for untrusted (guest) inserts. Exempts the service role (webhook), '
  'superadmins, and members of the target org (admin manual entry). Closes the '
  'guest field-tampering path from the appointments_public_insert WITH CHECK(true) '
  'policy (audit #1: self-approve / self-mark-paid / fabricated-completed).';

-- Runs before the other BEFORE INSERT guards (name sorts first); none of them
-- read the fields this normalises, so ordering is not load-bearing.
DROP TRIGGER IF EXISTS trg_00_normalize_guest_appointment ON appointments;
CREATE TRIGGER trg_00_normalize_guest_appointment
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION normalize_guest_appointment();
