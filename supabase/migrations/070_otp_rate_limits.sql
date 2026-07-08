-- ============================================================
-- 070_otp_rate_limits.sql
-- Run AFTER 069_appointment_insert_hardening.sql.
--
-- SMS-pumping / quota-exhaustion protection for the public OTP endpoints
-- (security audit 2026-07-08, finding #4). request-booking-otp and
-- request-password-reset are anonymous and each accepted call sends an SMS;
-- the only guard was a 60s per-phone cooldown, keyed on attacker-chosen input.
-- Once a real SMS provider is wired, an attacker rotating phone numbers could
-- farm delivery fees at ~1 SMS/second indefinitely.
--
-- This migration adds:
--   * request_ip on both verification tables (recorded by the edge functions)
--   * platform_config.otp_rate_limits — superadmin-tunable caps, no deploy
--   * check_otp_rate_limit(phone, ip) — called by the edge functions BEFORE
--     issuing a code. Counts codes across BOTH tables (an attacker could
--     otherwise split traffic between the booking and reset endpoints):
--       - ip_burst:     per-IP, short window (throttles a single source)
--       - ip_daily:     per-IP, 24h
--       - phone_daily:  per-phone, 24h (bounds the per-number cost)
--       - global_daily: platform-wide, 24h (wallet circuit-breaker: caps the
--         worst-case daily SMS spend even against a distributed attack)
--
-- Only issued codes create rows, so counting rows counts actual SMS sends;
-- cooldown/limit refusals cost nothing and are not counted. purge_expired_data
-- (064) keeps rows >= 24h past expiry, so the 24h windows are never undercut.
--
-- NOTE: per-IP limits are a rate bound, not a full defense — a distributed
-- attacker rotates IPs. The global cap bounds the damage; CAPTCHA is the
-- escalation path if that cap is ever hit organically.
-- ============================================================

ALTER TABLE booking_verifications        ADD COLUMN IF NOT EXISTS request_ip text;
ALTER TABLE password_reset_verifications ADD COLUMN IF NOT EXISTS request_ip text;

COMMENT ON COLUMN booking_verifications.request_ip IS
  'Caller IP (first x-forwarded-for hop) recorded by request-booking-otp for rate limiting.';
COMMENT ON COLUMN password_reset_verifications.request_ip IS
  'Caller IP (first x-forwarded-for hop) recorded by request-password-reset for rate limiting.';

CREATE INDEX IF NOT EXISTS idx_booking_verifications_ip
  ON booking_verifications (request_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_verifications_ip
  ON password_reset_verifications (request_ip, created_at DESC);

-- --------------------------------------------------------
-- Tunable limits (mirrors tier_limits / retention_config). Values here are the
-- PRODUCTION defaults; the hosted project temporarily overrides them with
-- relaxed values while the '000000' test bypass is active (e2e re-requests
-- codes for the same phones/IP constantly). Reset to DEFAULT at launch —
-- tracked with the other temporary flags in docs/APP_OVERVIEW.md.
-- --------------------------------------------------------
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS otp_rate_limits jsonb NOT NULL
  DEFAULT '{"ip_burst_count":5,"ip_burst_minutes":10,"ip_daily":20,"phone_daily":6,"global_daily":1000}'::jsonb;

COMMENT ON COLUMN platform_config.otp_rate_limits IS
  'Caps on OTP SMS issuance enforced by check_otp_rate_limit: ip_burst_count per '
  'ip_burst_minutes, ip_daily, phone_daily, global_daily (all counting both '
  'booking and password-reset codes).';

-- --------------------------------------------------------
-- The gate. Returns NULL when the request may proceed, otherwise the name of
-- the violated limit ('ip_burst' | 'ip_daily' | 'phone_daily' | 'global_daily').
-- Service-role only (called by the edge functions before issuing a code).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION check_otp_rate_limit(p_phone text, p_ip text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg              jsonb;
  ip_burst_count   int;
  ip_burst_minutes int;
  ip_daily         int;
  phone_daily      int;
  global_daily     int;
  burst_since      timestamptz;
  day_since        timestamptz := now() - interval '24 hours';
  n                bigint;
BEGIN
  SELECT otp_rate_limits INTO cfg FROM platform_config WHERE id = 1;
  ip_burst_count   := coalesce((cfg ->> 'ip_burst_count')::int,   5);
  ip_burst_minutes := coalesce((cfg ->> 'ip_burst_minutes')::int, 10);
  ip_daily         := coalesce((cfg ->> 'ip_daily')::int,         20);
  phone_daily      := coalesce((cfg ->> 'phone_daily')::int,      6);
  global_daily     := coalesce((cfg ->> 'global_daily')::int,     1000);
  burst_since      := now() - make_interval(mins => ip_burst_minutes);

  IF p_ip IS NOT NULL THEN
    SELECT (SELECT count(*) FROM booking_verifications
             WHERE request_ip = p_ip AND created_at > burst_since)
         + (SELECT count(*) FROM password_reset_verifications
             WHERE request_ip = p_ip AND created_at > burst_since)
      INTO n;
    IF n >= ip_burst_count THEN RETURN 'ip_burst'; END IF;

    SELECT (SELECT count(*) FROM booking_verifications
             WHERE request_ip = p_ip AND created_at > day_since)
         + (SELECT count(*) FROM password_reset_verifications
             WHERE request_ip = p_ip AND created_at > day_since)
      INTO n;
    IF n >= ip_daily THEN RETURN 'ip_daily'; END IF;
  END IF;

  SELECT (SELECT count(*) FROM booking_verifications
           WHERE phone = p_phone AND created_at > day_since)
       + (SELECT count(*) FROM password_reset_verifications
           WHERE phone = p_phone AND created_at > day_since)
    INTO n;
  IF n >= phone_daily THEN RETURN 'phone_daily'; END IF;

  -- Both tables are purged daily (064), so these unindexed counts stay cheap.
  SELECT (SELECT count(*) FROM booking_verifications        WHERE created_at > day_since)
       + (SELECT count(*) FROM password_reset_verifications WHERE created_at > day_since)
    INTO n;
  IF n >= global_daily THEN RETURN 'global_daily'; END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION check_otp_rate_limit IS
  'SMS-pumping guard for the OTP edge functions: returns NULL when a code may '
  'be issued for (phone, ip), else the violated limit name. Limits live in '
  'platform_config.otp_rate_limits; counts span booking + password-reset codes.';

-- Edge functions call this with the service role; nothing else should.
REVOKE EXECUTE ON FUNCTION check_otp_rate_limit(text, text) FROM PUBLIC, anon, authenticated;
