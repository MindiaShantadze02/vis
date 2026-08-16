-- ============================================================
-- 20260816120000_block_unpaid_bookings.sql
--
-- BUG: a business whose billing period had closed and whose bill was unpaid kept
-- receiving customer bookings.
--
-- Cause: org_can_accept_appointment (last set in 20260724120000_retire_billing_model)
-- was `billing_status <> 'suspended'`, so a 'past_due' org was fully open. That one
-- predicate is what EVERY enforcement point consults — the trg_enforce_appointment_limit
-- BEFORE INSERT trigger (028), create-payment's checkout pre-check, and the public
-- booking page — so past_due leaked through all of them at once.
--
-- Worse, reaching 'suspended' takes notice_days (3) + retry_schedule [1,3,7] +
-- grace_days (7) ≈ 10-11 days after the period closes, so "the month is over and
-- they haven't paid" was never a blocking state for a week and a half.
--
-- Fix: require billing_status = 'active' to accept bookings, and close the
-- reschedule hole (an UPDATE, so the INSERT trigger never fired for it).
--
-- Recovery is unchanged: settle_usage_charge already flips the org back to
-- 'active' once nothing is outstanding (20260724170000:68-74), so paying the
-- bill immediately restores booking.
-- ============================================================

-- --------------------------------------------------------
-- 1. The predicate every enforcement point shares.
--
--    NULL is preserved for a missing org — create-payment relies on the
--    difference to answer 'org_not_found' rather than 'limit_reached'.
--    Stays anon-executable: the public booking page calls it directly to render
--    its unavailable state before the customer fills anything in.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_can_accept_appointment(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT billing_status = 'active' FROM organisations WHERE id = p_org_id;
$function$;

COMMENT ON FUNCTION org_can_accept_appointment IS
  'True only while the org is billing ''active''. BOTH ''past_due'' and '
  '''suspended'' block new bookings (20260816120000) — previously only '
  '''suspended'' did, which let an unpaid business keep taking bookings for the '
  'whole ~11-day dunning window. Returns NULL when the org does not exist '
  '(create-payment distinguishes that case). Consulted by '
  'trg_enforce_appointment_limit (028), create-payment, reschedule_appointment_slot '
  'and the public booking page.';

-- --------------------------------------------------------
-- 2. reschedule_appointment_slot — supersedes 20260721130000.
--
--    Rescheduling is an UPDATE, so trg_enforce_appointment_limit (BEFORE INSERT)
--    never fired: a blocked org's customers could still move bookings into a
--    fresh billable period. Cancelling deliberately stays allowed — it reduces
--    the business's liability, and stranding a customer with a booking they can
--    neither move nor cancel would be worse than the leak.
--
--    Also drops the dead 'pending' arm of the status guard: that status was
--    removed in 20260814120000_remove_pending_status.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_appointment_slot(p_appointment_id uuid, p_scheduled_at timestamp with time zone, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'not_reschedulable';
  END IF;

  -- Billing gate: an unpaid org may not gain a booking on a new date. Fails
  -- closed — a NULL (org vanished mid-flight) blocks rather than allows.
  IF NOT coalesce(org_can_accept_appointment(v_org_id), false) THEN
    RAISE EXCEPTION 'billing_blocked';
  END IF;

  -- Availability guard (defence in depth): reject a reschedule to a closed day,
  -- out-of-hours or past time even if the caller crafts the request directly.
  IF NOT booking_time_available(v_org_id, p_scheduled_at, v_duration) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  v_end := v_start + make_interval(mins => v_duration);

  PERFORM pg_advisory_xact_lock(hashtext(v_org_id::text));

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_members mem
      JOIN service_staff ss ON ss.member_id = mem.id AND ss.service_id = v_service_id
     WHERE mem.id = p_staff_id AND mem.org_id = v_org_id AND mem.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

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
$function$;

COMMENT ON FUNCTION reschedule_appointment_slot IS
  'Moves an appointment to a new slot, re-validating billing, working hours, '
  'capacity + staff under the per-org advisory lock (excluding the moved row). '
  'Service-role only; the OTP gate is in the manage-appointment edge fn. Raises '
  'not_found | not_reschedulable | billing_blocked | slot_taken | '
  'staff_not_available.';

REVOKE ALL ON FUNCTION reschedule_appointment_slot(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reschedule_appointment_slot(uuid, timestamptz, uuid) TO service_role;
