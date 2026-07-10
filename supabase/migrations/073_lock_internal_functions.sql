-- 073_lock_internal_functions.sql
--
-- Security hardening: strip the default EXECUTE grant from four SECURITY DEFINER
-- functions that are only ever meant to run from pg_cron (as postgres) or as
-- internal helpers called by other definer functions. Postgres grants EXECUTE
-- on new public functions to PUBLIC — and Supabase's default privileges also
-- grant it to anon + authenticated directly — so without an explicit revoke
-- these were reachable as unauthenticated PostgREST RPC
-- (POST /rest/v1/rpc/<name>). Same pattern and rationale as migration 056.
--
-- Reachability before this migration (has_function_privilege('anon', …)):
--   dispatch_appointment_reminders()  → anon could trigger the reminder-SMS
--       sweep on demand and front-run the cron's timing.
--   complete_elapsed_appointments()   → anon could flip past-due appointments to
--       'completed' platform-wide (gates review-request eligibility).
--   org_usage(uuid)                   → anon could read any org's period usage.
--   org_subscription_state(uuid)      → anon could read any org's plan state.
--
-- The two readers are still called INTERNALLY by other SECURITY DEFINER
-- functions (dispatch_appointment_reminders, list_orgs_overview,
-- org_can_accept_appointment). Those calls keep working: a definer function's
-- inner calls are privilege-checked against the function owner, not the original
-- caller. No application code calls any of these four via RPC.

REVOKE ALL ON FUNCTION public.dispatch_appointment_reminders()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_elapsed_appointments()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_usage(uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_subscription_state(uuid)       FROM PUBLIC, anon, authenticated;
