-- ============================================================
-- 20260818120000_appointment_refunds.sql
-- Run AFTER 20260817150000_remove_public_api.sql.
--
-- Standalone refunds: money-state stops being welded to schedule-state.
--
-- Until now the only way for a business to refund was to CANCEL — refund-payment
-- required a new_status, and the affordance lived inside the cancel dialog. That
-- left real cases unserviceable: a complaint after a completed visit, a deposit
-- to return, or a cancellation that was taken last week with the refund box
-- unticked. Refunds also left no trace a business could read: the amount lives
-- in payment_log, which is superadmin-only and cannot simply be opened up
-- because it ALSO carries the platform's own subscription charges.
--
-- appointment_refunds is the org-readable refund ledger. One row per refund
-- ATTEMPT (pending → succeeded | failed), written by the service role only
-- (refund-payment today; manage-appointment and payment-webhook can join later
-- via initiated_via).
--
-- Rows rather than columns on `appointments`, because partial refunds are 1:N —
-- a second partial is another INSERT plus one enum value, not a redesign.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.appointment_refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  org_id             uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  appointment_id     uuid NOT NULL REFERENCES public.appointments(id)  ON DELETE CASCADE,

  -- What was actually returned. Sourced from payment_log (what the gateway
  -- charged), never from services.price — prices drift after booking, and for a
  -- deposit the service price is simply the wrong number.
  amount             numeric(10,2) NOT NULL CHECK (amount > 0),
  currency           text NOT NULL DEFAULT 'GEL',
  -- Full refunds only today. When partials land they arrive as is_full = false
  -- rows summing against payment_log.amount; nothing here has to change.
  is_full            boolean NOT NULL DEFAULT true,

  provider           text NOT NULL,
  provider_reference text,
  refund_reference   text,

  -- 'succeeded' means the GATEWAY ACCEPTED the refund, not that the money has
  -- landed — a real provider settles over days. The mock accepts instantly.
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'succeeded', 'failed')),

  -- Who pressed the button. The name is snapshotted because a member can be
  -- removed from the org later and an audit row must stay readable.
  initiated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_by_name  text,
  initiated_via      text NOT NULL DEFAULT 'admin'
                       CHECK (initiated_via IN ('admin', 'customer', 'system')),
  reason             text,
  error              text,

  -- Whether this refund also cancelled the booking. A refund only cancels when
  -- the appointment was still live (approved); a completed or no-show visit
  -- keeps its status so history — and the billable count — is not rewritten.
  cancelled_appointment boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.appointment_refunds IS
  'Org-readable ledger of refund attempts against appointment charges. Written '
  'by the service role (refund-payment). payment_log stays superadmin-only — it '
  'also holds the platform subscription charges.';

COMMENT ON COLUMN public.appointment_refunds.status IS
  'The row is inserted as ''pending'' BEFORE the gateway call, so a crash '
  'mid-refund leaves a reconcilable trace rather than nothing. Reconcile with: '
  'SELECT * FROM appointment_refunds WHERE status = ''pending'' AND created_at < now() - interval ''10 minutes'';';

COMMENT ON COLUMN public.appointment_refunds.amount IS
  'Taken from payment_log.amount (what the gateway actually charged), never '
  'from services.price.';

CREATE INDEX IF NOT EXISTS appointment_refunds_appt_idx
  ON public.appointment_refunds (appointment_id);
CREATE INDEX IF NOT EXISTS appointment_refunds_org_created_idx
  ON public.appointment_refunds (org_id, created_at DESC);

-- ------------------------------------------------------------
-- RLS: org members read their own refunds; every write is service-role
-- (mirrors credit_purchases / payment_log's write posture).
-- ------------------------------------------------------------
ALTER TABLE public.appointment_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_refunds_select ON public.appointment_refunds;
CREATE POLICY appointment_refunds_select ON public.appointment_refunds
  FOR SELECT TO authenticated
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

-- Supabase's default schema grants hand anon/authenticated full DML on any new
-- public table; RLS is the only thing stopping them. For a money ledger that is
-- one missing policy away from being writable, so strip the writes outright —
-- the same posture payment_log carries. Every write here is service-role.
REVOKE ALL ON public.appointment_refunds FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.appointment_refunds FROM authenticated;
GRANT SELECT ON public.appointment_refunds TO authenticated;
