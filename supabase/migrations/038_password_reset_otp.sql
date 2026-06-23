-- ============================================================
-- 038_password_reset_otp.sql
-- Run AFTER 037_booking_theme_indigo_rose.sql.
--
-- Phone-OTP password recovery for the admin app. Login is phone+password and
-- users have no email, so the built-in email reset can't be used. A user who
-- forgets their password requests a code texted to their phone, then sets a new
-- one. Codes are issued/checked by the request-password-reset / reset-password
-- edge functions (service role), mirroring the guest-booking OTP flow (030).
--
-- This migration adds the storage table and a helper to resolve a local phone
-- to its auth user id (auth.users is not reachable via PostgREST, so the edge
-- functions go through this SECURITY DEFINER function instead of listUsers).
-- ============================================================

CREATE TABLE password_reset_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  verified_at timestamptz,
  consumed_at timestamptz
);

COMMENT ON TABLE password_reset_verifications IS
  'One-time phone-verification challenges for password recovery. code_hash is '
  'sha256(code:phone:secret). A row is verified and consumed by the '
  'reset-password edge function once the new password is set.';

CREATE INDEX idx_password_reset_verifications_phone
  ON password_reset_verifications (phone, created_at DESC);

-- All access is via service-role edge functions. Enable RLS with no anon
-- policies; allow superadmin read for auditing only.
ALTER TABLE password_reset_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "password_reset_verifications_superadmin_select"
  ON password_reset_verifications FOR SELECT
  USING (is_superadmin());

-- --------------------------------------------------------
-- Resolve a bare 9-digit Georgian local number to its auth user id. Auth stores
-- phones as E.164 digits without a leading '+' (e.g. '995599123456'), so we
-- prefix '995'. SECURITY DEFINER because auth.users is owner-only; locked down
-- to service_role (the edge functions) — never exposed to anon/authenticated.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_user_id_by_phone(p_local text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM auth.users WHERE phone = '995' || p_local LIMIT 1;
$$;

COMMENT ON FUNCTION public.auth_user_id_by_phone IS
  'Maps a bare 9-digit Georgian local phone to its auth.users id (prefixes '
  '''995''). Used by the password-reset edge functions. service_role only.';

REVOKE ALL ON FUNCTION public.auth_user_id_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_phone(text) TO service_role;
