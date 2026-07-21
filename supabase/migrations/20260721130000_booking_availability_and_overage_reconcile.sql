-- Two exploratory-testing fixes (2026-07-21):
--
-- FIX 2 — server-side availability validation on the guest booking paths.
-- `create_guest_booking` and `reschedule_appointment_slot` enforced capacity,
-- the advance-window (upper bound), OTP and the tier limit, but NOT working
-- hours or past-time. The public REST `api` edge function does validate those,
-- so a crafted request (post-OTP) could place a guest booking at 03:00, on a
-- closed day, or in the past — confirmed live (an auto-approved 03:00 booking).
-- The normal UI never hits this (it only offers valid slots). We add a shared
-- `booking_time_available()` guard, fail-OPEN when an org has no working-hours
-- template (matches the app's "default slots" fallback so nothing legit breaks),
-- and raise 'slot_taken' (which both clients already map to "time unavailable").
--
-- FIX 1 — overage billing asymmetry. `record_appointment_overage` recorded an
-- overage_events row per appointment booked beyond the included allowance, but on
-- cancel only deleted the row when the *flagged* appointment itself was cancelled.
-- Since org_usage excludes cancelled rows, cancelling an INCLUDED appointment
-- dropped usage back within allowance while overage_count stayed > 0 — billing
-- depended on WHICH row was cancelled, and the dashboard showed a contradictory
-- "within allowance" + overage charge. The UPDATE branch now reconciles the
-- period's overage count down to max(0, usage - included).

-- ── Shared availability helper ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.booking_time_available(
  p_org_id uuid, p_scheduled_at timestamptz, p_duration int)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_local     timestamp;
  v_date      date;
  v_dow       int;
  v_cfg       jsonb;
  v_ranges    jsonb;
  v_ovr       working_hours_overrides%rowtype;
  v_has_tpl   boolean;
  v_start_min int;
  v_end_min   int;
  r           jsonb;
  v_rs        int;
  v_re        int;
BEGIN
  -- A booking can't start in the past.
  IF p_scheduled_at < now() THEN
    RETURN false;
  END IF;

  v_local     := (p_scheduled_at AT TIME ZONE 'Asia/Tbilisi');
  v_date      := v_local::date;
  v_start_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_end_min   := v_start_min + p_duration;

  -- Same-date override wins over the weekly template.
  SELECT * INTO v_ovr FROM working_hours_overrides
   WHERE org_id = p_org_id AND date = v_date;
  IF FOUND THEN
    IF v_ovr.is_closed THEN RETURN false; END IF;
    v_ranges := coalesce(v_ovr.ranges, '[]'::jsonb);
  ELSE
    v_dow := extract(dow from v_local)::int;  -- 0=Sun .. 6=Sat
    SELECT true,
      CASE v_dow WHEN 0 THEN sunday WHEN 1 THEN monday WHEN 2 THEN tuesday
                 WHEN 3 THEN wednesday WHEN 4 THEN thursday WHEN 5 THEN friday
                 ELSE saturday END
      INTO v_has_tpl, v_cfg
      FROM working_hours_template WHERE org_id = p_org_id;
    -- Fail OPEN when the org has no template at all (the app falls back to
    -- default slots) so we never block a legitimate booking.
    IF v_has_tpl IS NULL THEN RETURN true; END IF;
    IF v_cfg IS NULL OR NOT coalesce((v_cfg->>'open')::boolean, false) THEN
      RETURN false;
    END IF;
    v_ranges := coalesce(v_cfg->'ranges', '[]'::jsonb);
  END IF;

  -- The full [start, start+duration] must fit inside one open range.
  FOR r IN SELECT jsonb_array_elements(v_ranges) LOOP
    v_rs := split_part(r->>'start',':',1)::int*60 + split_part(r->>'start',':',2)::int;
    v_re := split_part(r->>'end',':',1)::int*60 + split_part(r->>'end',':',2)::int;
    IF v_start_min >= v_rs AND v_end_min <= v_re THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;

-- ── Guest booking: add the availability guard ────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_guest_booking(p_org_id uuid, p_service_id uuid, p_scheduled_at timestamp with time zone, p_first_name text, p_last_name text, p_phone text, p_notes text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid, p_auto_assign boolean DEFAULT false, p_consent_version text DEFAULT NULL::text)
 RETURNS TABLE(appointment_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Availability guard (defence in depth): the public form only offers valid
  -- slots, but a crafted request could target a closed day / out-of-hours /
  -- past time. The client maps 'slot_taken' to "that time isn't available".
  IF NOT booking_time_available(p_org_id, p_scheduled_at, v_duration) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  v_start := p_scheduled_at;
  v_end   := p_scheduled_at + make_interval(mins => v_duration);

  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text));

  IF p_staff_id IS NOT NULL THEN
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

  INSERT INTO customers (first_name, last_name, phone_number,
                         consent_accepted_at, consent_version)
  VALUES (trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''),
          p_phone, now(), p_consent_version)
  RETURNING customers.id INTO v_customer_id;

  INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at,
                            duration_minutes, staff_id, status,
                            payment_method, payment_status, notes)
  VALUES (p_org_id, p_service_id, v_customer_id, p_scheduled_at,
          v_duration, v_staff_id, 'pending',
          'in_person', 'unpaid', nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING appointments.id, appointments.status INTO v_appt_id, v_status;

  RETURN QUERY SELECT v_appt_id, v_status;
END;
$function$;

-- ── Reschedule: add the availability guard ───────────────────────────────────
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
  IF v_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'not_reschedulable';
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

-- ── Overage: reconcile the period count on cancel/reject ─────────────────────
CREATE OR REPLACE FUNCTION public.record_appointment_overage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tier     text;
  v_anchor   timestamptz;
  v_limit    int;
  v_price    numeric(10,2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('rejected', 'cancelled')
       AND OLD.status NOT IN ('rejected', 'cancelled') THEN
      -- Reconcile the period's overage count to max(0, usage - included).
      -- Cancelling ANY appointment reduces net usage, so it must be able to
      -- reduce the metered overage — not only when the cancelled row was itself
      -- the flagged one. Otherwise `used` could drop back within allowance while
      -- overage_count stayed > 0 (billing depending on WHICH row was cancelled).
      SELECT o.subscription_tier, o.usage_anchor,
             (pc.tier_limits ->> o.subscription_tier)::int
        INTO v_tier, v_anchor, v_limit
        FROM organisations o
        CROSS JOIN platform_config pc
       WHERE o.id = NEW.org_id AND pc.id = 1;

      -- Drop the cancelled appointment's own flag first (a cancelled row must
      -- not remain billed), then trim the newest remaining events for the
      -- period down to the target count.
      DELETE FROM overage_events WHERE appointment_id = NEW.id;

      IF v_limit IS NOT NULL THEN
        DELETE FROM overage_events
         WHERE id IN (
           SELECT id FROM overage_events
            WHERE org_id = NEW.org_id
              AND period_start = current_period_start(v_anchor)::date
            ORDER BY created_at DESC, id DESC
            OFFSET GREATEST(0, org_usage(NEW.org_id) - v_limit)
         );
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status IN ('rejected', 'cancelled') THEN
    RETURN NULL;
  END IF;

  IF org_subscription_state(NEW.org_id) <> 'active' THEN
    RETURN NULL;
  END IF;

  SELECT o.subscription_tier, o.usage_anchor,
         (pc.tier_limits ->> o.subscription_tier)::int,
         (pc.tier_overage_prices ->> o.subscription_tier)::numeric
    INTO v_tier, v_anchor, v_limit, v_price
    FROM organisations o
    CROSS JOIN platform_config pc
   WHERE o.id = NEW.org_id AND pc.id = 1;

  IF v_limit IS NULL THEN
    RETURN NULL;
  END IF;

  IF org_usage(NEW.org_id) > v_limit THEN
    INSERT INTO overage_events (org_id, appointment_id, period_start, unit_price)
    VALUES (NEW.org_id, NEW.id, current_period_start(v_anchor)::date, COALESCE(v_price, 0))
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;

  RETURN NULL;
END;
$function$;
