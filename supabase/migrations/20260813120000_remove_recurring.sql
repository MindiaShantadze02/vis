-- ============================================================
-- 20260813120000_remove_recurring.sql
--
-- Removes recurring appointments (095 + the per-service recurrence defaults in
-- 20260722130000). Vis is positioned as a pure online-booking platform: guests
-- book single appointments through the public flow, and the owner-side manual
-- entry that created series was removed, leaving this whole feature unreachable.
--
-- Existing occurrences are KEPT as ordinary appointments — dropping series_id
-- only removes their link to the (now deleted) series, never the bookings
-- themselves. Nothing else references recurrence_series.
-- ============================================================

-- --------------------------------------------------------
-- 1. The series RPCs (owner writers) — gone first, they depend on everything
--    below.
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS create_recurrence_series(uuid, uuid, uuid, text, text, text, timestamptz, text, text, int, date, text);
DROP FUNCTION IF EXISTS cancel_recurrence_series(uuid);

-- --------------------------------------------------------
-- 2. send_appointment_sms — same body as 095 minus its series_id guard (there
--    are no series rows to suppress any more). Behaviour for every other
--    appointment is unchanged here; the NEXT migration
--    (20260813130000_customer_sms_policy) re-gates it so it fires once per
--    booking instead of on every appointment write.
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
-- 3. The occurrence back-reference, then the series table itself.
-- --------------------------------------------------------
DROP INDEX IF EXISTS idx_appointments_series;
ALTER TABLE appointments DROP COLUMN IF EXISTS series_id;

DROP TABLE IF EXISTS recurrence_series;

-- --------------------------------------------------------
-- 4. Per-service recurrence defaults (20260722130000) — they only ever
--    pre-filled the removed owner-side series form.
-- --------------------------------------------------------
ALTER TABLE services
  DROP COLUMN IF EXISTS recurring_default,
  DROP COLUMN IF EXISTS recurring_cadence,
  DROP COLUMN IF EXISTS recurring_occurrence_count;
