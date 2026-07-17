-- ============================================================
-- 092_self_service_manage.sql
-- Run AFTER 091_deposit_value_constraints.sql.
--
-- Phase 3 — customer self-service reschedule / cancel. A /manage/:appointmentId
-- page (the appointment UUID is the capability, like /review) lets the customer
-- reschedule or cancel without logging in, gated behind a booking OTP. This
-- migration is the DB layer:
--
--   * get_manage_context(uuid)          — anon read RPC (stripped jsonb) that
--                                          drives the /manage page.
--   * reschedule_appointment_slot(...)  — service-role writer that re-validates
--                                          capacity under the per-org advisory
--                                          lock (the INSERT trigger doesn't fire
--                                          on an UPDATE) and moves the slot.
--   * slot_freed_events + trigger       — records a freed future slot on cancel/
--                                          reject/reschedule, for ANY actor
--                                          (customer or owner). Phase 4 (waitlist)
--                                          consumes it.
--   * sms_log.message_type             — + reschedule_update, cancellation_update.
--
-- The OTP gate + refund-on-cancel live in the manage-appointment edge function
-- (refunds need the payment provider seam). This migration has no test bypasses.
-- ============================================================

-- --------------------------------------------------------
-- 1. Freed-slot ledger. One row per future slot vacated by a cancel/reject or a
--    reschedule-away, written ONLY by the trigger below (SECURITY DEFINER). The
--    waitlist (Phase 4) reads unprocessed rows and stamps processed_at.
-- --------------------------------------------------------
CREATE TABLE slot_freed_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- The appointment that vacated the slot; nulled if it's later deleted.
  appointment_id  uuid REFERENCES appointments(id) ON DELETE SET NULL,
  service_id      uuid NOT NULL,
  staff_id        uuid,
  -- The vacated slot's start (business instant) + its length.
  freed_at        timestamptz NOT NULL,
  duration_minutes int NOT NULL,
  reason          text NOT NULL CHECK (reason IN ('cancelled', 'rejected', 'rescheduled')),
  -- Phase 4 stamps this once the waitlist has offered the slot.
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_slot_freed_unprocessed
  ON slot_freed_events (org_id, freed_at) WHERE processed_at IS NULL;

COMMENT ON TABLE slot_freed_events IS
  'Future slots freed by a cancel/reject/reschedule (any actor). Written only by '
  'record_slot_freed; consumed by the Phase 4 cancellation waitlist.';

ALTER TABLE slot_freed_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slot_freed_events_select" ON slot_freed_events
  FOR SELECT TO public
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

-- --------------------------------------------------------
-- 2. Emit a freed-slot row when an appointment leaves a future slot. Fires for
--    owner-side cancels (dashboard) AND customer-side cancels/reschedules, so
--    the waitlist works regardless of who acted. Past slots are ignored (they
--    can't be rebooked).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION record_slot_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_freed  timestamptz;
  v_reason text;
BEGIN
  IF NEW.status IN ('cancelled', 'rejected')
     AND OLD.status NOT IN ('cancelled', 'rejected') THEN
    -- Cancel/reject: scheduled_at is unchanged, so the vacated slot is OLD's.
    v_freed  := OLD.scheduled_at;
    v_reason := NEW.status;
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NEW.status IN ('pending', 'approved')
     AND OLD.status IN ('pending', 'approved') THEN
    -- Rescheduled away from the old time.
    v_freed  := OLD.scheduled_at;
    v_reason := 'rescheduled';
  ELSE
    RETURN NULL;
  END IF;

  IF v_freed > now() THEN
    INSERT INTO slot_freed_events (org_id, appointment_id, service_id, staff_id, freed_at, duration_minutes, reason)
    VALUES (OLD.org_id, OLD.id, OLD.service_id, OLD.staff_id, v_freed, OLD.duration_minutes, v_reason);
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION record_slot_freed IS
  'AFTER UPDATE on appointments: records a slot_freed_events row when a future '
  'slot is vacated by a cancel/reject or a reschedule-away (any actor).';

CREATE TRIGGER trg_record_slot_freed
  AFTER UPDATE OF status, scheduled_at ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION record_slot_freed();

REVOKE ALL ON FUNCTION record_slot_freed() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------
-- 3. get_manage_context — the /manage page read. The UUID is the capability;
--    this returns only non-sensitive booking fields + derived can-manage /
--    refund flags (the phone is masked). Strips everything private.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION get_manage_context(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'org_id',                    o.id,
    'org_name',                  o.name,
    'slug',                      o.slug,
    'booking_theme',             o.booking_theme,
    'service_id',                s.id,
    'service_name',              s.name,
    'price',                     s.price,
    'scheduled_at',              a.scheduled_at,
    'duration_minutes',          a.duration_minutes,
    'staff_id',                  a.staff_id,
    'staff_name',                m.display_name,
    'status',                    a.status,
    'payment_status',            a.payment_status,
    'phone_masked',              '••••' || right(c.phone_number, 2),
    'cancellation_window_hours', o.cancellation_window_hours,
    'deposit_refundable',        o.deposit_refundable,
    -- Manageable only while pending/approved and still in the future.
    'can_manage',                (a.status IN ('pending', 'approved') AND a.scheduled_at > now()),
    -- Would a cancel right now refund the online payment/deposit?
    'refund_on_cancel',          (
       a.status IN ('pending', 'approved') AND a.scheduled_at > now()
       AND a.payment_status IN ('paid', 'deposit_paid') AND a.payment_reference IS NOT NULL
       AND o.deposit_refundable
       AND a.scheduled_at >= now() + make_interval(hours => o.cancellation_window_hours)
    )
  )
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  JOIN services s      ON s.id = a.service_id
  JOIN customers c     ON c.id = a.customer_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.id = p_appointment_id;
$$;

COMMENT ON FUNCTION get_manage_context IS
  'Public read for /manage/:appointmentId — stripped booking context + derived '
  'can_manage / refund_on_cancel flags. Phone is masked. UUID is the capability.';

REVOKE ALL ON FUNCTION get_manage_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_manage_context(uuid) TO anon, authenticated;

-- --------------------------------------------------------
-- 4. reschedule_appointment_slot — move a booking to a new slot. The INSERT
--    capacity trigger (084) doesn't fire on UPDATE, so this re-validates
--    capacity itself under the SAME per-org advisory lock, excluding the row
--    being moved. Service-role only (the manage-appointment edge fn calls it
--    after verifying the OTP). Raises slot_taken / not_reschedulable /
--    service_not_found / staff_not_available — mirroring the booking path.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION reschedule_appointment_slot(
  p_appointment_id uuid,
  p_scheduled_at   timestamptz,
  p_staff_id       uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id     uuid;
  v_service_id uuid;
  v_duration   int;
  v_status     text;
  v_start      timestamptz := p_scheduled_at;
  v_end        timestamptz;
  v_cap        int;
  v_overlaps   int;
BEGIN
  SELECT a.org_id, a.service_id, a.duration_minutes, a.status
    INTO v_org_id, v_service_id, v_duration, v_status
    FROM appointments a WHERE a.id = p_appointment_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'not_reschedulable';
  END IF;

  v_end := v_start + make_interval(mins => v_duration);

  -- Same lock as trg_enforce_slot_capacity (084) so the re-check sees a frozen
  -- busy-set (reentrant within the txn).
  PERFORM pg_advisory_xact_lock(hashtext(v_org_id::text));

  -- A named staff member must be bookable and assigned to the service.
  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_members mem
      JOIN service_staff ss ON ss.member_id = mem.id AND ss.service_id = v_service_id
     WHERE mem.id = p_staff_id AND mem.org_id = v_org_id AND mem.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  -- Per-service capacity at the new slot, EXCLUDING this appointment.
  SELECT s.max_per_slot INTO v_cap FROM services s WHERE s.id = v_service_id;
  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = v_org_id
     AND a.service_id = v_service_id
     AND a.id <> p_appointment_id
     AND a.status NOT IN ('rejected', 'cancelled')
     AND a.scheduled_at > v_start - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start;
  IF v_overlaps >= coalesce(v_cap, 1) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  -- A named person can't be double-booked (any service), EXCLUDING this appt.
  IF p_staff_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.org_id = v_org_id
       AND a.staff_id = p_staff_id
       AND a.id <> p_appointment_id
       AND a.status NOT IN ('rejected', 'cancelled')
       AND a.scheduled_at > v_start - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  UPDATE appointments
     SET scheduled_at = v_start,
         staff_id     = p_staff_id,
         updated_at   = now()
   WHERE id = p_appointment_id;
END;
$$;

COMMENT ON FUNCTION reschedule_appointment_slot IS
  'Moves an appointment to a new slot, re-validating capacity + staff under the '
  'per-org advisory lock (excluding the moved row). Service-role only; the OTP '
  'gate is in the manage-appointment edge fn. Raises slot_taken on race.';

REVOKE ALL ON FUNCTION reschedule_appointment_slot(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reschedule_appointment_slot(uuid, timestamptz, uuid) TO service_role;

-- --------------------------------------------------------
-- 5. New SMS message types.
-- --------------------------------------------------------
ALTER TABLE sms_log DROP CONSTRAINT sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation', 'approval_update', 'admin_new_booking', 'admin_reminder',
    'invitation', 'verification_code', 'appointment_reminder', 'setup_complete',
    'meeting_link', 'refund_update', 'reschedule_update', 'cancellation_update'
  ));
