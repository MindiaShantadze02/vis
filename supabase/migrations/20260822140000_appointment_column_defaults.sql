-- ============================================================
-- 20260822140000_appointment_column_defaults.sql
--
-- BUG (reported): booking on your own booking page WHILE SIGNED IN as the
-- business owner failed with the generic "couldn't finish your booking".
-- The real error was:
--     null value in column "payment_method" violates not-null constraint
--
-- Cause: normalize_guest_appointment deliberately exempts org members (so
-- owner/e2e/service tooling can set these fields itself) and returns early
-- BEFORE pinning anything. `payment_method` is NOT NULL with **no default**, so
-- an insert from a member context that omits it — which is exactly what the
-- public booking form sends, since it relies on the trigger — dies. Anonymous
-- customers were never affected; only the owner testing their own page.
--
-- Pre-existing (the form has never sent payment_method), but invisible because
-- every e2e books in a fresh anonymous context.
--
-- SECOND, worse problem found alongside it: `status` still carried
-- `DEFAULT 'pending'` from 001_tables. While 'pending' was an illegal status
-- (2026-08-14 → 2026-08-22) that default was merely dead — any insert omitting
-- status failed the CHECK. Now that 20260822120000 has made 'pending' legal
-- again, that stale default silently turns any member-context insert that omits
-- status into an unapproved REQUEST — including one on an org that never opted
-- into approval. Column defaults are applied before BEFORE-triggers run, so the
-- trigger cannot tell "omitted" from "explicitly pending" and cannot fix it.
--
-- Fix both at the column level, which is where the truth belongs:
--   * status         → 'approved'  (bookings are approved unless the org opted
--                       in, and the guest path sets it explicitly either way)
--   * payment_method → 'in_person' (the same value the guest trigger pins; the
--                       online path is always explicit, set by payment-webhook)
--
-- The member exemption itself stays: e2e seeding and the refund/meeting-link
-- specs rely on being able to insert 'online'/'paid' rows verbatim, and pinning
-- over them would break that.
-- ============================================================
ALTER TABLE public.appointments ALTER COLUMN status         SET DEFAULT 'approved';
ALTER TABLE public.appointments ALTER COLUMN payment_method SET DEFAULT 'in_person';

COMMENT ON COLUMN public.appointments.status IS
  'pending | approved | rejected | cancelled | completed | no_show. Defaults to '
  '''approved'': ''pending'' is only ever set deliberately by '
  'normalize_guest_appointment for an on-site booking at a require_approval org. '
  'The old DEFAULT ''pending'' (001) became a live hazard when 20260822120000 '
  'made that status legal again.';

COMMENT ON COLUMN public.appointments.payment_method IS
  'online | in_person. Defaults to ''in_person'' so a member-context insert that '
  'omits it (the public form relies on the guest trigger, which exempts members) '
  'cannot violate NOT NULL.';
