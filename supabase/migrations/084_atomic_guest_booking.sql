-- ============================================================
-- 084_atomic_guest_booking.sql
-- Run AFTER 083_solo_team_tiers.sql.
--
-- Closes the guest double-booking race (client-side check-then-insert TOCTOU)
-- and makes the guest booking atomic (customer + appointment in one
-- transaction, so a failure can no longer leave an orphan customer row).
--
-- Two pieces:
--   1. enforce_slot_capacity — BEFORE INSERT trigger. Serializes untrusted
--      inserts per org via pg_advisory_xact_lock, then re-runs the capacity /
--      staff-overlap checks the client does in Step 2/3. Covers EVERY
--      untrusted path: the booking widget, direct PostgREST inserts from a
--      tampered client, and api_create_booking (public API — which previously
--      had NO overlap check at all).
--   2. create_guest_booking — anon-callable SECURITY DEFINER RPC the booking
--      page now uses instead of its two direct inserts. Validates, resolves
--      "any available" staff under the same advisory lock, and inserts
--      customer + appointment atomically.
--
-- Deliberately NOT checked:
--   * org members / superadmins (dashboard manual entry) — walk-in overbooking
--     is a legitimate admin action, same trust model as the 069/081 normalizer.
--   * payment-webhook (service_role, no app.api_booking GUC) — the charge has
--     already cleared; rejecting here would take money without a booking and
--     no refund flow exists. That race predates this migration and is
--     unchanged.
--
-- OTP posture unchanged: create_guest_booking does NOT set the app.api_booking
-- GUC, so trg_enforce_booking_verification (030/071) still requires and
-- consumes a verified OTP for the customer phone. The customers RLS OTP policy
-- (081) is bypassed inside the definer, but the appointment insert in the same
-- transaction re-enforces it — a failed verification rolls back the customer
-- row too, so the "anon customer rows only via verified OTP" invariant holds.
--
-- Trigger ordering (BEFORE INSERT fires alphabetically):
--   trg_00_normalize_guest_appointment   — validates service/staff, pins duration
--   trg_enforce_appointment_limit
--   trg_enforce_booking_advance_window
--   trg_enforce_booking_verification     — consumes the OTP
--   trg_enforce_slot_capacity            — THIS ONE, last: duration is already
--                                          pinned, and a slot_taken raise rolls
--                                          back the OTP consumption above.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_slot_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap      int;
  v_start    timestamptz;
  v_end      timestamptz;
  v_overlaps int;
BEGIN
  -- Trusted contexts may overbook deliberately (see header). The public API
  -- (service_role + app.api_booking GUC set by api_create_booking) IS checked.
  IF (auth.role() = 'service_role'
      AND current_setting('app.api_booking', true) IS DISTINCT FROM '1')
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent untrusted inserts for this org. Transaction-scoped:
  -- released automatically on commit/rollback. create_guest_booking takes the
  -- same lock (advisory locks are reentrant within a session), so its staff
  -- auto-assignment and this check see the same frozen busy-set.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.org_id::text));

  v_start := NEW.scheduled_at;
  v_end   := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);

  -- Per-service capacity, same semantics as the client (Step3) and slots.ts:
  -- overlapping = aStart < slotEnd AND aEnd > slotStart, statuses excluding
  -- only rejected/cancelled (matching get_org_busy_slots, 066/075). The lower
  -- scheduled_at bound keeps idx_appointments_org_scheduled usable; no
  -- appointment lasts a day.
  SELECT s.max_per_slot INTO v_cap
    FROM services s
   WHERE s.id = NEW.service_id;

  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = NEW.org_id
     AND a.service_id = NEW.service_id
     AND a.status NOT IN ('rejected', 'cancelled')
     AND a.scheduled_at > v_start - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start;

  IF v_overlaps >= coalesce(v_cap, 1) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  -- A named person can't be in two places at once (any service counts).
  IF NEW.staff_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM appointments a
     WHERE a.org_id = NEW.org_id
       AND a.staff_id = NEW.staff_id
       AND a.status NOT IN ('rejected', 'cancelled')
       AND a.scheduled_at > v_start - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_slot_capacity IS
  'BEFORE INSERT on appointments: under a per-org advisory lock, rejects '
  'untrusted inserts that exceed the service''s max_per_slot or double-book a '
  'staff member (raises ''slot_taken''). Exempts org members, superadmins and '
  'the payment webhook; the public API path IS checked. Closes the guest '
  'check-then-insert double-booking race (084).';

DROP TRIGGER IF EXISTS trg_enforce_slot_capacity ON appointments;
CREATE TRIGGER trg_enforce_slot_capacity
  BEFORE INSERT ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_slot_capacity();

-- --------------------------------------------------------
-- Atomic guest booking writer. Replaces the booking page's two direct inserts
-- (customers, then appointments). Same validation surface as api_create_booking
-- plus "any available" staff resolution, which must happen under the lock —
-- picking a member client-side and losing the race was half the TOCTOU bug.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION create_guest_booking(
  p_org_id          uuid,
  p_service_id      uuid,
  p_scheduled_at    timestamptz,
  p_first_name      text,
  p_last_name       text,
  p_phone           text,
  p_notes           text DEFAULT NULL,
  p_staff_id        uuid DEFAULT NULL,
  p_auto_assign     boolean DEFAULT false,
  p_consent_version text DEFAULT NULL
)
RETURNS TABLE (appointment_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration    int;
  v_start       timestamptz;
  v_end         timestamptz;
  v_staff_id    uuid;
  v_customer_id uuid;
  v_appt_id     uuid;
  v_status      text;
BEGIN
  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  v_start := p_scheduled_at;
  v_end   := p_scheduled_at + make_interval(mins => v_duration);

  -- Same per-org lock as trg_enforce_slot_capacity: everything below — the
  -- staff pick and the trigger's capacity re-check — sees one frozen busy-set.
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text));

  IF p_staff_id IS NOT NULL THEN
    -- Named person: must be assigned to the service and bookable (the 081
    -- normalizer re-validates; checked here for the cleaner error) and free.
    IF NOT EXISTS (
      SELECT 1
        FROM service_staff ss
        JOIN org_members m ON m.id = ss.member_id
       WHERE ss.service_id = p_service_id
         AND ss.member_id = p_staff_id
         AND m.is_bookable
    ) THEN
      RAISE EXCEPTION 'staff_not_available';
    END IF;
    v_staff_id := p_staff_id;
  ELSIF p_auto_assign THEN
    -- "Any available": first assigned bookable member with no overlapping
    -- appointment, by the same sort_order the booking page displays.
    SELECT m.id INTO v_staff_id
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = p_service_id
       AND m.is_bookable
       AND NOT EXISTS (
         SELECT 1
           FROM appointments a
          WHERE a.org_id = p_org_id
            AND a.staff_id = m.id
            AND a.status NOT IN ('rejected', 'cancelled')
            AND a.scheduled_at > v_start - interval '1 day'
            AND a.scheduled_at < v_end
            AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
       )
     ORDER BY m.sort_order, m.id
     LIMIT 1;
    IF v_staff_id IS NULL THEN
      RAISE EXCEPTION 'slot_taken';
    END IF;
  END IF;

  -- NO app.api_booking GUC here: the OTP trigger on the appointment insert
  -- below must still verify + consume the guest's code.
  INSERT INTO customers (first_name, last_name, phone_number,
                         consent_accepted_at, consent_version)
  VALUES (trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''),
          p_phone, now(), p_consent_version)
  RETURNING customers.id INTO v_customer_id;

  -- The 081 normalizer pins duration/status/payment fields; the insert triggers
  -- raise limit_reached / booking_too_far_in_advance / verification_required /
  -- slot_taken, all of which roll back the customer row above too.
  INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at,
                            duration_minutes, staff_id, status,
                            payment_method, payment_status, notes)
  VALUES (p_org_id, p_service_id, v_customer_id, p_scheduled_at,
          v_duration, v_staff_id, 'pending',
          'in_person', 'unpaid', nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING appointments.id, appointments.status INTO v_appt_id, v_status;

  RETURN QUERY SELECT v_appt_id, v_status;
END;
$$;

COMMENT ON FUNCTION create_guest_booking IS
  'Atomic guest booking (booking widget): validates the service, resolves the '
  'staff pick ("any available" included) under the per-org advisory lock, and '
  'inserts customer + appointment in one transaction. OTP is still required '
  'and consumed by trg_enforce_booking_verification; capacity is enforced by '
  'trg_enforce_slot_capacity under the same lock. Raises service_not_found | '
  'staff_not_available | slot_taken (plus trigger errors limit_reached, '
  'booking_too_far_in_advance, verification_required).';

REVOKE EXECUTE ON FUNCTION create_guest_booking(uuid, uuid, timestamptz, text, text, text, text, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_guest_booking(uuid, uuid, timestamptz, text, text, text, text, uuid, boolean, text) TO anon, authenticated;
