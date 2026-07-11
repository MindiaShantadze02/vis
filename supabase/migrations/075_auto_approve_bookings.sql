-- ============================================================
-- 075_auto_approve_bookings.sql
-- Run AFTER 074_service_images.sql.
--
-- Public bookings now AUTO-APPROVE by default, paid or not. Each organisation
-- gets an opt-out toggle (organisations.require_approval) surfaced in the
-- dashboard's Booking page settings; when it is on, guest bookings return to
-- the old manual pending -> approved workflow.
--
-- Notes:
--   * pending and approved both block slots (066 get_org_busy_slots and the
--     api fn exclude only rejected/cancelled), so flipping the default cannot
--     double-book.
--   * the approval SMS trigger (031) already fires on INSERT of an 'approved'
--     guest booking, so auto-approved bookings get the approval_update SMS
--     with no SMS changes.
--   * the initial status is still decided SERVER-SIDE by the 069 normaliser,
--     never by the client, preserving the 069 anti-tampering posture.
-- ============================================================

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organisations.require_approval IS
  'When true, guest bookings are created as ''pending'' and must be approved '
  'manually. When false (default), guest bookings auto-approve on insert.';

-- --------------------------------------------------------
-- Supersedes 069: the guest-insert normaliser now derives the initial status
-- from the org''s require_approval flag instead of hard-pinning ''pending''.
-- Trusted-context exemptions and the other pinned fields are unchanged.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_guest_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_require_approval boolean;
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
  -- booking is always in-person + unpaid; online bookings are created only by
  -- the service-role webhook (exempt above), never by the public client.
  -- The initial status follows the org's approval preference; if the org
  -- lookup ever misses, fail safe to the manual 'pending' workflow.
  SELECT o.require_approval INTO v_require_approval
    FROM organisations o
   WHERE o.id = NEW.org_id;

  NEW.status            := CASE WHEN coalesce(v_require_approval, true)
                                THEN 'pending' ELSE 'approved' END;
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
  'defaults for untrusted (guest) inserts. Status follows the org''s '
  'require_approval flag (false = auto-approve, 075). Exempts the service role '
  '(webhook), superadmins, and members of the target org (admin manual entry). '
  'Closes the guest field-tampering path from the appointments_public_insert '
  'WITH CHECK(true) policy (069 audit #1).';

-- --------------------------------------------------------
-- Supersedes 071: when the API caller omits `status`, derive it from the
-- org's require_approval flag instead of always defaulting to 'pending'.
-- An explicit 'pending' | 'approved' from the caller is still honored
-- (service-role only; the key-authenticated org acts on itself).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION api_create_booking(
  p_org_id          uuid,
  p_service_id      uuid,
  p_first_name      text,
  p_last_name       text,
  p_phone           text,
  p_scheduled_at    timestamptz,
  p_staff_id        uuid DEFAULT NULL,
  p_notes           text DEFAULT NULL,
  p_status          text DEFAULT NULL,
  p_consent_version text DEFAULT NULL
)
RETURNS TABLE (appointment_id uuid, status text, scheduled_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration    int;
  v_customer_id uuid;
  v_appt_id     uuid;
  v_status      text;
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  -- Omitted status follows the org's approval preference (fail safe: pending).
  v_status := coalesce(
    p_status,
    (SELECT CASE WHEN coalesce(o.require_approval, true)
                 THEN 'pending' ELSE 'approved' END
       FROM organisations o
      WHERE o.id = p_org_id),
    'pending');

  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = p_service_id
       AND ss.member_id = p_staff_id
       AND m.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  -- Transaction-local: read by enforce_booking_verification (see 071).
  PERFORM set_config('app.api_booking', '1', true);

  INSERT INTO customers (first_name, last_name, phone_number,
                         consent_accepted_at, consent_version)
  VALUES (p_first_name, nullif(trim(coalesce(p_last_name, '')), ''), p_phone,
          now(), p_consent_version)
  RETURNING customers.id INTO v_customer_id;

  INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at,
                            duration_minutes, staff_id, status,
                            payment_method, payment_status,
                            payment_provider, payment_reference,
                            notes, admin_notes)
  VALUES (p_org_id, p_service_id, v_customer_id, p_scheduled_at,
          v_duration, p_staff_id, v_status,
          'in_person', 'unpaid',
          NULL, NULL,
          nullif(trim(coalesce(p_notes, '')), ''), NULL)
  RETURNING appointments.id INTO v_appt_id;

  RETURN QUERY SELECT v_appt_id, v_status, p_scheduled_at;
END;
$$;

COMMENT ON FUNCTION api_create_booking IS
  'Public-API booking writer: validates service/staff, sets the app.api_booking '
  'GUC (OTP exemption), inserts customer + appointment with pinned payment '
  'fields. Omitted status follows organisations.require_approval (075). '
  'Tier-limit / advance-window / SMS triggers still apply. Raises '
  'invalid_status | service_not_found | staff_not_available (plus trigger '
  'errors limit_reached, booking_too_far_in_advance). Service-role only.';
