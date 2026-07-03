-- ============================================================
-- 065_anonymize_retention.sql
-- Run AFTER 064_data_retention.sql.
--
-- Refines the retention sweep (Law of Georgia on Personal Data Protection,
-- No. 3144, Art. 4(e) — data may be "deleted, destroyed, OR anonymized").
--
-- Change vs 064: aged appointments are ANONYMIZED in place instead of hard-
-- deleted. Anonymized data is no longer personal data, so it satisfies storage
-- limitation, while the appointment skeleton (service, price, date, status) is
-- kept for the business's legitimate revenue/statistics and for tax/accounting
-- record-keeping (financial documents kept ~6 years). Mirrors the Art. 16
-- erasure RPC erase_customer_data() (064).
--
-- Also: consumed pending_bookings (redundant PII already promoted into
-- customers/appointments) are now purged too, not kept indefinitely.
--
-- Retention windows still come from platform_config.retention_config; the key
-- `appointments_months` now means "anonymize after", not "delete after".
-- ============================================================

-- Marker: when an appointment's client PII was stripped. Also dedupes the sweep
-- so already-anonymized rows are skipped.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

COMMENT ON COLUMN appointments.anonymized_at IS
  'When client PII (notes/admin_notes + linked customer name/phone) was stripped '
  'by the retention sweep (Art. 4(e)). NULL = still holds personal data.';

COMMENT ON COLUMN platform_config.retention_config IS
  'Data-retention windows (Art. 4(e)). Consumed by purge_expired_data(). Keys: '
  'appointments_months (anonymize appointments/customers after), sms_log_months '
  '(delete after), pending_bookings_days (delete after), verification_hours (delete after).';

-- --------------------------------------------------------
-- Redefines 064's sweep: transient data is still deleted; aged appointments are
-- anonymized rather than deleted.
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

  -- 2. Parked online bookings past the window — ALL statuses. Abandoned intents
  --    plus consumed ones (whose PII was already promoted into customers/
  --    appointments, so the parked copy is redundant).
  BEGIN
    DELETE FROM pending_bookings
     WHERE created_at < now() - make_interval(days => pending_days);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: pending_bookings purge failed: %', SQLERRM;
  END;

  -- 3. Aged appointments: ANONYMIZE (don't delete). Strip free-text PII and
  --    anonymize the linked guest record; keep the row for revenue/stats/tax.
  --    anonymized_at dedupes so this is idempotent across daily runs.
  BEGIN
    UPDATE customers c
       SET first_name          = 'erased',
           last_name           = NULL,
           phone_number        = '',
           consent_accepted_at = NULL,
           consent_version     = NULL
      FROM appointments a
     WHERE a.customer_id = c.id
       AND a.anonymized_at IS NULL
       AND a.scheduled_at < now() - make_interval(months => appt_months);

    UPDATE appointments
       SET notes = NULL, admin_notes = NULL, anonymized_at = now()
     WHERE anonymized_at IS NULL
       AND scheduled_at < now() - make_interval(months => appt_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: appointment anonymization failed: %', SQLERRM;
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
  'Retention sweep (Art. 4(e)): deletes expired verification codes, parked '
  'bookings and aged SMS logs; ANONYMIZES appointments/customers older than '
  'platform_config.retention_config.appointments_months (kept for revenue/tax). '
  'Runs daily via the purge-expired-data cron.';

-- Re-assert the daily cron idempotently so this migration is self-contained.
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
