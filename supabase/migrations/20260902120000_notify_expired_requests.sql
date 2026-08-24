-- ============================================================
-- 20260902120000_notify_expired_requests.sql
--
-- A customer whose booking REQUEST quietly expired was told nothing.
--
-- send_appointment_sms only fires the decline notice when
-- `auth.uid() IS NOT NULL` — i.e. only when a human pressed Decline. But
-- reject_elapsed_pending_appointments runs from cron with no auth.uid(), so a
-- request the business simply never got round to approving expired in silence.
-- The customer had seen "awaiting confirmation" and then heard nothing at all;
-- some would turn up expecting an appointment. 137 rejected appointments
-- currently have no decline SMS against them.
--
-- Decision (2026-08-20): send it. It costs one SMS per expiry, which is the
-- point — [[customer-sms-policy]] keeps customer messages minimal, and this is
-- the one case where silence is worse than a message.
--
-- Patched by splicing the LIVE definition rather than re-transcribing the body,
-- so this cannot silently revert unrelated parts of the trigger (the failure
-- mode that produced the 2026-08-17 no-card regression). Re-runnable: it exits
-- if the guard is already gone.
-- ============================================================
DO $outer$
DECLARE
  v_def    text;
  v_oid    oid;
  v_anchor constant text := E'NEW.status = ''rejected'' AND OLD.status = ''pending'' AND auth.uid() IS NOT NULL';
  v_new    constant text := E'NEW.status = ''rejected'' AND OLD.status = ''pending''';
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'send_appointment_sms';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'send_appointment_sms not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position(v_anchor in v_def) = 0 THEN
    -- Already patched (or the guard was reworded): do nothing rather than
    -- guess at the current shape.
    RAISE NOTICE 'send_appointment_sms: auth.uid() guard not present, leaving as is';
    RETURN;
  END IF;

  EXECUTE replace(v_def, v_anchor, v_new);
  RAISE NOTICE 'send_appointment_sms: expired requests now notify the customer';
END
$outer$;

COMMENT ON FUNCTION public.send_appointment_sms IS
  'Fires the customer SMS on appointment insert/approval, and the decline notice '
  'on pending -> rejected. The decline notice fires for BOTH an admin pressing '
  'Decline and the cron that expires an unapproved request — a customer who is '
  'never confirmed must not be left in silence.';
