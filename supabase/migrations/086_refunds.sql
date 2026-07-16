-- ============================================================
-- 086_refunds.sql
-- Run AFTER 085_sms_delivery_report.sql.
--
-- Refund groundwork (full refunds of online APPOINTMENT payments only — no
-- partial refunds, no subscription refunds). Two triggers exist:
--
--   1. Admin cancels a paid online appointment and leaves the "refund the
--      customer" checkbox ticked (the default) — the new refund-payment edge
--      function changes the status AND issues the refund in one call, so a
--      failed refund never leaves a cancelled-but-kept-money appointment.
--   2. payment-webhook fulfilment failure: the charge cleared but the
--      appointment couldn't be created (slot conflict / tier limit during
--      checkout). That's a system fault — auto-refund, no human in the loop.
--
-- The refund itself goes through the pluggable payment-provider seam
-- (_shared/payments): mock refunds always succeed; BOG/TBC stubs raise
-- provider_not_configured until real credentials exist (BOG has
-- POST /payments/v1/payment/refund/:order_id; TBC refunds settle in ≤3 bank
-- days — both support the flow once wired).
--
-- Schema-wise this is small:
--   * payment_log learns the refund lifecycle: status gains 'refunded'
--     (single-row transition paid → refunded, mirroring how
--     appointments.payment_status already models it — that CHECK has allowed
--     'refunded' since 001, nothing wrote it until now), plus refunded_at /
--     refund_reference for the audit trail. A refund the gateway REJECTS
--     leaves status='paid' and records the failure in `error`.
--   * sms_log.message_type gains 'refund_update' — the customer is texted
--     that their money is coming back (a silent refund is confusing since
--     settlement takes days).
-- No RLS changes: payment_log stays service-role-write / superadmin-read.
-- ============================================================

ALTER TABLE payment_log DROP CONSTRAINT IF EXISTS payment_log_status_check;
ALTER TABLE payment_log ADD CONSTRAINT payment_log_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'refunded'));

ALTER TABLE payment_log
  ADD COLUMN IF NOT EXISTS refunded_at      timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reference text;

COMMENT ON COLUMN payment_log.refunded_at IS
  'When the gateway ACCEPTED the refund (settlement may lag; acceptance is '
  'the point of no return). Set together with status=''refunded''.';
COMMENT ON COLUMN payment_log.refund_reference IS
  'Gateway-side id of the refund operation (mock: refund_mock_<uuid>).';

-- Allow the new message_type in the sms_log audit (mirrors SmsMessageType in
-- the edge functions). Full list re-stated, adding 'refund_update' (see 082).
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation','approval_update',
    'admin_new_booking','admin_reminder','invitation',
    'verification_code','appointment_reminder','setup_complete',
    'meeting_link','refund_update'
  ));
