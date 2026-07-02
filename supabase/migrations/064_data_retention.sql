-- ============================================================
-- 064_data_retention.sql
-- Run AFTER 063_phone_invitations.sql.
--
-- Data-protection compliance (Law of Georgia on Personal Data Protection,
-- No. 3144, in force 2024-03-01):
--
--   * Art. 4(e) storage limitation — personal data must not be kept longer than
--     necessary. This adds a daily pg_cron purge (mirrors 039's cron pattern)
--     that deletes stale verification codes, abandoned online bookings, and
--     aged appointment/customer/SMS records.
--   * Art. 12 / 32(9) consent proof — records when a client/business accepted
--     the Privacy Policy + Terms, and which version, so consent is provable.
--
-- Retention windows live in platform_config.retention_config so they can be
-- retuned via SQL without a code deploy.
-- ============================================================

-- --------------------------------------------------------
-- Consent capture (Art. 12 / 32(9)).
-- customers is the guest record created per booking; pending_bookings parks the
-- online-booking details until payment clears (consent flows through it into the
-- customer row created by payment-webhook).
-- --------------------------------------------------------
ALTER TABLE customers        ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz;
ALTER TABLE customers        ADD COLUMN IF NOT EXISTS consent_version     text;
ALTER TABLE pending_bookings ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz;
ALTER TABLE pending_bookings ADD COLUMN IF NOT EXISTS consent_version     text;

COMMENT ON COLUMN customers.consent_accepted_at IS
  'When this client accepted the Privacy Policy + Terms at booking (Art. 12/32(9) consent proof). NULL for legacy rows.';
COMMENT ON COLUMN customers.consent_version IS
  'Privacy Policy / Terms version string the client accepted (e.g. a date tag).';

-- --------------------------------------------------------
-- Retention windows (Art. 4(e)). Tunable without a deploy.
-- --------------------------------------------------------
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS retention_config jsonb NOT NULL
  DEFAULT '{"appointments_months":24,"sms_log_months":12,"pending_bookings_days":7,"verification_hours":24}'::jsonb;

COMMENT ON COLUMN platform_config.retention_config IS
  'Data-retention windows (Art. 4(e)). Consumed by purge_expired_data(). Keys: '
  'appointments_months, sms_log_months, pending_bookings_days, verification_hours.';

-- --------------------------------------------------------
-- Daily purge of personal data past its retention window.
-- SECURITY DEFINER so the cron (postgres role) bypasses RLS. Each step is
-- independent; a failure in one is logged and does not block the others.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_expired_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg               jsonb;
  appt_months       int;
  sms_months        int;
  pending_days      int;
  verification_hrs  int;
BEGIN
  SELECT retention_config INTO cfg FROM platform_config WHERE id = 1;

  appt_months      := coalesce((cfg ->> 'appointments_months')::int, 24);
  sms_months       := coalesce((cfg ->> 'sms_log_months')::int, 12);
  pending_days     := coalesce((cfg ->> 'pending_bookings_days')::int, 7);
  verification_hrs := coalesce((cfg ->> 'verification_hours')::int, 24);

  -- 1. Verification codes: short-lived; drop once well past expiry.
  BEGIN
    DELETE FROM booking_verifications
     WHERE expires_at < now() - make_interval(hours => verification_hrs);
    DELETE FROM password_reset_verifications
     WHERE expires_at < now() - make_interval(hours => verification_hrs);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: verification purge failed: %', SQLERRM;
  END;

  -- 2. Abandoned online bookings: parked intents that never became appointments.
  BEGIN
    DELETE FROM pending_bookings
     WHERE created_at < now() - make_interval(days => pending_days)
       AND status <> 'consumed';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: pending_bookings purge failed: %', SQLERRM;
  END;

  -- 3. Aged appointments, then the guest customers left with no appointment.
  --    Delete appointments first to avoid FK conflicts on customers.
  BEGIN
    DELETE FROM appointments
     WHERE scheduled_at < now() - make_interval(months => appt_months);

    DELETE FROM customers c
     WHERE c.created_at < now() - make_interval(months => appt_months)
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: appointment/customer purge failed: %', SQLERRM;
  END;

  -- 4. Aged SMS audit log.
  BEGIN
    DELETE FROM sms_log
     WHERE created_at < now() - make_interval(months => sms_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: sms_log purge failed: %', SQLERRM;
  END;
END;
$$;

COMMENT ON FUNCTION purge_expired_data IS
  'Deletes personal data past its retention window (Art. 4(e) storage limitation): '
  'expired verification codes, abandoned online bookings, appointments/customers and '
  'SMS logs older than platform_config.retention_config. Runs daily via the '
  'purge-expired-data cron.';

-- --------------------------------------------------------
-- Data-subject erasure (Art. 16). Lets a business (the controller of its
-- clients' data) honor a client's erasure request for one appointment: the
-- client's PII is anonymized in place rather than the row deleted, so the
-- business keeps its schedule/revenue history without retaining personal data.
-- SECURITY DEFINER; authorization is an explicit org-membership check.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION erase_customer_data(p_appointment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_customer_id uuid;
BEGIN
  SELECT org_id, customer_id INTO v_org_id, v_customer_id
    FROM appointments WHERE id = p_appointment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;

  -- Caller must belong to the appointment's organisation.
  IF NOT (v_org_id = ANY (get_user_org_ids())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Strip free-text that may hold personal data.
  UPDATE appointments
     SET notes = NULL, admin_notes = NULL
   WHERE id = p_appointment_id;

  -- Anonymize the guest record.
  IF v_customer_id IS NOT NULL THEN
    UPDATE customers
       SET first_name = 'erased',
           last_name  = NULL,
           phone_number = '',
           consent_accepted_at = NULL,
           consent_version = NULL
     WHERE id = v_customer_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION erase_customer_data IS
  'Anonymizes one appointment''s client PII (name/phone/notes) on request '
  '(Art. 16 right to erasure). Callable only by a member of the appointment''s org.';

GRANT EXECUTE ON FUNCTION erase_customer_data(uuid) TO authenticated;

-- (Re)schedule idempotently at 03:30 daily.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-data') THEN
    PERFORM cron.unschedule('purge-expired-data');
  END IF;

  PERFORM cron.schedule(
    'purge-expired-data',
    '30 3 * * *',
    $cron$ SELECT purge_expired_data(); $cron$
  );
END;
$$;
