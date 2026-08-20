-- ============================================================
-- 20260831140000_retention_remaining_tables.sql
-- Applied to cloud as: retention_for_remaining_pii_tables (2026-08-20)
--
-- Article 4(1)(e): six tables held personal data with no retention rule at all
-- (docs/COMPLIANCE_GE_DPL.md, finding G6). Five get one here.
--
-- `org_members` is deliberately EXCLUDED. Staff records are controller-managed
-- and already deletable from Team settings; a time-based purge would delete
-- ACTIVE staff. That exclusion is recorded as a decision in
-- docs/PROCESSING_RECORD.md rather than left looking like an oversight.
--
-- Reviews are the business's own reputation record, so the rating and the text
-- stay — only the reviewer's NAME is scrubbed once it has served its purpose.
-- ============================================================
UPDATE platform_config
   SET retention_config = retention_config || jsonb_build_object(
         'notifications_months',      6,
         'blocked_customers_months',  24,
         'setup_requests_months',     12,
         'invitations_days',          30,
         'review_author_months',      24)
 WHERE id = 1;

CREATE OR REPLACE FUNCTION public.purge_expired_data()
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  cfg               jsonb;
  appt_months       int;
  sms_months        int;
  pending_days      int;
  verification_hrs  int;
  notif_months      int;
  blocked_months    int;
  setup_months      int;
  invite_days       int;
  review_months     int;
BEGIN
  SELECT retention_config INTO cfg FROM platform_config WHERE id = 1;

  appt_months      := coalesce((cfg ->> 'appointments_months')::int, 24);
  sms_months       := coalesce((cfg ->> 'sms_log_months')::int, 12);
  pending_days     := coalesce((cfg ->> 'pending_bookings_days')::int, 7);
  verification_hrs := coalesce((cfg ->> 'verification_hours')::int, 24);
  notif_months     := coalesce((cfg ->> 'notifications_months')::int, 6);
  blocked_months   := coalesce((cfg ->> 'blocked_customers_months')::int, 24);
  setup_months     := coalesce((cfg ->> 'setup_requests_months')::int, 12);
  invite_days      := coalesce((cfg ->> 'invitations_days')::int, 30);
  review_months    := coalesce((cfg ->> 'review_author_months')::int, 24);

  -- Each block is independent: one failure must not abort the rest of the run.
  BEGIN
    DELETE FROM booking_verifications
     WHERE expires_at < now() - make_interval(hours => verification_hrs);
    DELETE FROM password_reset_verifications
     WHERE expires_at < now() - make_interval(hours => verification_hrs);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: verification purge failed: %', SQLERRM;
  END;

  BEGIN
    DELETE FROM pending_bookings
     WHERE created_at < now() - make_interval(days => pending_days);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: pending_bookings purge failed: %', SQLERRM;
  END;

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

  BEGIN
    DELETE FROM sms_log
     WHERE created_at < now() - make_interval(months => sms_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: sms_log purge failed: %', SQLERRM;
  END;

  -- Dashboard notifications carry the customer's NAME in the body and are
  -- ephemeral UI — no reason to keep them once read or stale.
  BEGIN
    DELETE FROM notifications
     WHERE created_at < now() - make_interval(months => notif_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: notifications purge failed: %', SQLERRM;
  END;

  -- A block is a last-resort measure, not a life sentence: it expires, and the
  -- business can re-apply it if the behaviour recurs.
  BEGIN
    DELETE FROM blocked_customers
     WHERE created_at < now() - make_interval(months => blocked_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: blocked_customers purge failed: %', SQLERRM;
  END;

  -- Concierge onboarding requests: purpose is spent once completed.
  BEGIN
    DELETE FROM setup_requests
     WHERE status = 'completed'
       AND coalesce(completed_at, created_at) < now() - make_interval(months => setup_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: setup_requests purge failed: %', SQLERRM;
  END;

  -- Staff invitations: gone once accepted or long expired.
  BEGIN
    DELETE FROM invitations
     WHERE (accepted_at IS NOT NULL AND accepted_at < now() - make_interval(days => invite_days))
        OR (accepted_at IS NULL AND expires_at < now() - make_interval(days => invite_days));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: invitations purge failed: %', SQLERRM;
  END;

  -- Reviews: keep rating + text (the business's reputation record), scrub only
  -- the reviewer's name.
  BEGIN
    UPDATE reviews
       SET author_name = 'erased'
     WHERE author_name IS NOT NULL
       AND author_name <> 'erased'
       AND created_at < now() - make_interval(months => review_months);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purge_expired_data: review author scrub failed: %', SQLERRM;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
