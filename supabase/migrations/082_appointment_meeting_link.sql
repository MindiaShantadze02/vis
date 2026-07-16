-- ============================================================
-- 082_appointment_meeting_link.sql
-- Run AFTER 081_security_audit_hardening.sql.
--
-- Moves the online meeting link from the SERVICE to the APPOINTMENT.
-- Each online appointment can happen on a different link, so a single
-- per-service URL was the wrong model (and it was never actually sent:
-- no trigger/edge function ever read services.meeting_link). Now the
-- owner attaches a join link to the specific appointment and sends it to
-- the customer over SMS with an explicit action.
--
--   1. Relax the services constraint that forced an online service to
--      carry a link (services.meeting_link stays but is no longer written).
--   2. Add appointments.meeting_link (nullable, http(s), <= 500 chars).
--   3. request_meeting_link_sms(appointment) — owner-invoked RPC that POSTs
--      to the send-sms edge function (message_type 'meeting_link'), mirroring
--      the send_appointment_sms() trigger (031). The client can't call
--      send-sms directly (server-only x-sms-secret), so this is the path.
--   4. Extend search_appointments to expose meeting_link + the service's
--      location_type so the dashboard dialog can show/prefill the field.
-- ============================================================

-- 1. Online services no longer require a link. Keep the column and its
--    other checks (in_person must be NULL / http(s) / length) intact.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_online_needs_link;

-- 2. Per-appointment meeting link. Existing rows are all NULL, so the
--    checks validate immediately (no NOT VALID needed).
ALTER TABLE appointments ADD COLUMN meeting_link text;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_meeting_link_format
  CHECK (meeting_link IS NULL OR meeting_link ~* '^https?://');

ALTER TABLE appointments
  ADD CONSTRAINT appointments_meeting_link_max_length
  CHECK (meeting_link IS NULL OR char_length(meeting_link) <= 500);

COMMENT ON COLUMN appointments.meeting_link IS
  'Per-appointment virtual meeting URL for online services. Set by the owner '
  'in the dashboard and sent to the customer via request_meeting_link_sms. '
  'NULL until the owner attaches one.';

-- Allow the new message_type in the sms_log audit (mirrors SmsMessageType in
-- the edge function). Full list re-stated, adding 'meeting_link' (see 078).
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation','approval_update',
    'admin_new_booking','admin_reminder','invitation',
    'verification_code','appointment_reminder','setup_complete',
    'meeting_link'
  ));

-- 3. Owner-invoked "send the meeting link" SMS. SECURITY DEFINER (so it can
--    reach platform_config + pg_net), which bypasses RLS — hence the explicit
--    org-membership check on auth.uid().
CREATE OR REPLACE FUNCTION request_meeting_link_sms(p_appointment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_link   text;
  v_url    text;
  v_secret text;
BEGIN
  SELECT org_id, meeting_link INTO v_org_id, v_link
    FROM appointments
   WHERE id = p_appointment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'appointment not found' USING errcode = 'no_data_found';
  END IF;

  -- Caller must be a member of the appointment's org.
  IF NOT EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = v_org_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized' USING errcode = 'insufficient_privilege';
  END IF;

  IF v_link IS NULL OR btrim(v_link) = '' THEN
    RAISE EXCEPTION 'no meeting link set' USING errcode = 'check_violation';
  END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  IF v_url IS NULL THEN
    -- SMS not configured (e.g. local dev without a provider). No-op rather
    -- than error, matching send_appointment_sms()'s tolerance.
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
                 'appointment_id', p_appointment_id,
                 'message_type', 'meeting_link'
               ),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sms-secret', coalesce(v_secret, '')
               )
  );
END;
$$;

COMMENT ON FUNCTION request_meeting_link_sms IS
  'Owner-invoked: POSTs to the send-sms edge function to text the customer the '
  'appointment''s meeting_link (message_type ''meeting_link''). Org-member gated.';

-- Internal to signed-in org members only — not anon/public.
REVOKE ALL ON FUNCTION request_meeting_link_sms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_meeting_link_sms(uuid) TO authenticated;

-- 4. Surface meeting_link + the service's location_type to the dashboard list.
--    The RETURNS TABLE gains a column, which CREATE OR REPLACE can't do (42P13:
--    cannot change return type), so drop the old signature (014) first. No DB
--    object depends on it — the dashboard calls it over PostgREST — and it keeps
--    default PUBLIC EXECUTE / SECURITY INVOKER, so recreating is safe.
DROP FUNCTION IF EXISTS search_appointments(uuid, text, text, timestamptz, timestamptz, int, int);

CREATE FUNCTION search_appointments(
  p_org_id    uuid,
  p_status    text        DEFAULT NULL,
  p_search    text        DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to   timestamptz DEFAULT NULL,
  p_limit     int         DEFAULT 100,
  p_offset    int         DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  scheduled_at     timestamptz,
  duration_minutes int2,
  service_id       uuid,
  staff_id         uuid,
  status           text,
  payment_method   text,
  payment_status   text,
  notes            text,
  admin_notes      text,
  meeting_link     text,
  customers        jsonb,
  services         jsonb,
  staff            jsonb,
  total_count      bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    a.scheduled_at,
    a.duration_minutes,
    a.service_id,
    a.staff_id,
    a.status,
    a.payment_method,
    a.payment_status,
    a.notes,
    a.admin_notes,
    a.meeting_link,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name',   c.first_name,
      'last_name',    c.last_name,
      'phone_number', c.phone_number
    ) END AS customers,
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name',             s.name,
      'price',            s.price,
      'duration_minutes', s.duration_minutes,
      'location_type',    s.location_type
    ) END AS services,
    CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',           m.id,
      'display_name', m.display_name,
      'title',        m.title
    ) END AS staff,
    -- Full filtered total (computed before LIMIT/OFFSET), identical
    -- on every row; the client reads it off the first row.
    count(*) OVER() AS total_count
  FROM appointments a
  LEFT JOIN customers   c ON c.id = a.customer_id
  LEFT JOIN services    s ON s.id = a.service_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.org_id = p_org_id
    AND (p_status    IS NULL OR a.status = p_status)
    AND (p_date_from IS NULL OR a.scheduled_at >= p_date_from)
    AND (p_date_to   IS NULL OR a.scheduled_at <= p_date_to)
    AND (
      p_search IS NULL OR p_search = '' OR
      c.first_name   ILIKE '%' || p_search || '%' OR
      c.last_name    ILIKE '%' || p_search || '%' OR
      c.phone_number ILIKE '%' || p_search || '%' OR
      s.name         ILIKE '%' || p_search || '%'
    )
  -- Pending (needs action) first, then newest scheduled first within each group.
  ORDER BY (a.status = 'pending') DESC, a.scheduled_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION search_appointments IS
  'Dashboard appointments list: server-side status + text + date-range '
  'filter with pagination (offset/limit) and total_count via count(*) OVER(). '
  'Returns the per-appointment meeting_link and the service location_type. '
  'Orders pending (action-needed) appointments first, then newest scheduled. '
  'Runs SECURITY INVOKER so RLS applies.';
