-- ============================================================
-- 095_recurring_appointments.sql
-- Run AFTER 094_waitlist_offer_fks.sql.
--
-- Phase 5 — recurring appointments. Owner/staff-created standing bookings
-- (weekly / biweekly / monthly) for trainers, clinics, regular salon clients.
--
-- Design: materialize rows (each occurrence is a real appointment carrying a
-- series_id), so reminders/capacity/calendar all see them like any booking. The
-- series is BOUNDED (end after N occurrences, or until a date; capped at 52), so
-- all occurrences are generated at creation — no cron, no rolling horizon, and
-- the inserts run in the owner's context (clean triggers: member = exempt from
-- OTP/capacity/normalize, so status stays 'approved'). Conflicting slots are
-- SKIPPED and reported (made/skipped counts), never silently dropped. Each
-- occurrence meters against the tier allowance (088) like any appointment.
--
-- Reschedule/cancel: "this occurrence" is a normal single-appointment edit (a
-- cancel frees the slot → waitlist, 092/093). cancel_recurrence_series ends the
-- series and cancels all FUTURE occurrences ("this and following" / "entire").
-- ============================================================

-- --------------------------------------------------------
-- 1. Series + the occurrence back-reference.
-- --------------------------------------------------------
CREATE TABLE recurrence_series (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_id        uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id          uuid REFERENCES org_members(id) ON DELETE SET NULL,
  cadence           text NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly')),
  -- First occurrence datetime (business instant) + its snapshotted length.
  start_at          timestamptz NOT NULL,
  duration_minutes  int NOT NULL,
  end_type          text NOT NULL CHECK (end_type IN ('count', 'until')),
  occurrence_count  int,
  until_date        date,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recurrence_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurrence_series_select" ON recurrence_series
  FOR SELECT TO public USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

ALTER TABLE appointments
  ADD COLUMN series_id uuid REFERENCES recurrence_series(id) ON DELETE SET NULL;
CREATE INDEX idx_appointments_series ON appointments (series_id) WHERE series_id IS NOT NULL;

-- --------------------------------------------------------
-- 2. Suppress the per-occurrence booking-confirmation SMS for series inserts —
--    a standing appointment the owner arranged shouldn't text the customer once
--    per occurrence. (A single "series created" SMS is a later refinement.)
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION send_appointment_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  -- Recurring-series occurrences are created in bulk by the owner; no per-row SMS.
  IF NEW.series_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('appointment_id', NEW.id, 'message_type', 'booking_confirmation'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_appointment_sms failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- --------------------------------------------------------
-- 3. create_recurrence_series — owner writer. Creates the customer + series and
--    generates every occurrence (bounded, capped at 52), skipping any that
--    collide with an existing booking. Owner context (auth.uid = member), so the
--    appointment triggers keep status 'approved' and don't demand an OTP; the
--    per-service capacity trigger EXEMPTS members, so we check capacity here
--    under the per-org advisory lock. Returns {series_id, made, skipped}.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION create_recurrence_series(
  p_org_id           uuid,
  p_service_id       uuid,
  p_staff_id         uuid,
  p_first_name       text,
  p_last_name        text,
  p_phone            text,
  p_start_at         timestamptz,
  p_cadence          text,
  p_end_type         text,
  p_occurrence_count int  DEFAULT NULL,
  p_until_date       date DEFAULT NULL,
  p_notes            text DEFAULT NULL
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

  INSERT INTO customers (first_name, last_name, phone_number)
  VALUES (trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''), p_phone)
  RETURNING id INTO v_customer;

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
                                staff_id, status, payment_method, payment_status, notes, series_id)
      VALUES (p_org_id, p_service_id, v_customer, v_occ, v_dur, p_staff_id,
              'approved', 'in_person', 'unpaid', p_notes, v_series);
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
  'Owner writer: creates a recurring series + its (bounded, capped-52) occurrences, '
  'skipping slots that collide. Returns {series_id, made, skipped}.';
REVOKE ALL ON FUNCTION create_recurrence_series(uuid, uuid, uuid, text, text, text, timestamptz, text, text, int, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_recurrence_series(uuid, uuid, uuid, text, text, text, timestamptz, text, text, int, date, text) TO authenticated;

-- --------------------------------------------------------
-- 4. cancel_recurrence_series — ends the series and cancels all FUTURE
--    occurrences (past ones are history). Each cancel frees its slot (092/093).
--    Returns how many occurrences were cancelled. Owner/superadmin only.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_recurrence_series(p_series_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org   uuid;
  v_count int;
BEGIN
  SELECT org_id INTO v_org FROM recurrence_series WHERE id = p_series_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT (v_org = ANY (get_user_org_ids()) OR is_superadmin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE appointments SET status = 'cancelled', updated_at = now()
   WHERE series_id = p_series_id AND status IN ('pending', 'approved') AND scheduled_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE recurrence_series SET status = 'cancelled' WHERE id = p_series_id;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION cancel_recurrence_series IS
  'Ends a series and cancels its future occurrences (each frees its slot). '
  'Returns the count cancelled. Owner/superadmin only.';
REVOKE ALL ON FUNCTION cancel_recurrence_series(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_recurrence_series(uuid) TO authenticated;
