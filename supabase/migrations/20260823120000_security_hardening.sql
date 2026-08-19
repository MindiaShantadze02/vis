-- ============================================================
-- 20260823120000_security_hardening.sql
--
-- Findings from the 2026-08-19 security sweep. Each section states the attack
-- it closes; nothing here changes product behaviour.
-- ============================================================

-- ------------------------------------------------------------
-- 1. BILLING BYPASS (exploitable): usage_anchor was owner-writable.
--
-- organisations_update (004) has no column list and no WITH CHECK, and
-- `authenticated` holds full-table UPDATE, so an owner can PATCH any column.
-- prevent_billing_self_update froze exactly two: billing_status, billing_exempt.
--
-- usage_anchor drives the period loop in close_billing_period_for_org, which
-- returns NULL while the period end is still in the future. So:
--     PATCH /rest/v1/organisations?id=eq.<mine> {"usage_anchor":"<now>"}
-- once a month ⇒ no billing_periods row, no line items, no charge, no dunning.
-- Free forever, from the owner's own dashboard credentials.
--
-- owner_id was writable for the same reason (a long-standing known gap): setting
-- it to a victim's uuid hands them SELECT on your org row, because
-- organisations_select ORs `owner_id = auth.uid()` — and it redirects the
-- billing-notice notification that close_billing_period_for_org sends.
--
-- Same escape hatch as the existing guards, deliberately unchanged: the service
-- role (auth.uid() IS NULL), superadmins, and the app.internal_billing GUC. The
-- coalesce() matters — without it an unset GUC makes the comparison NULL and the
-- whole IF NOT(...) never fires (the three-valued-logic hole fixed in 20260723150000).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_billing_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_platform boolean := (
    auth.uid() IS NULL
    OR is_superadmin()
    OR coalesce(current_setting('app.internal_billing', true), '') = '1'
  );
BEGIN
  IF (NEW.billing_status IS DISTINCT FROM OLD.billing_status) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: billing_status changes only via payment or superadmin';
  END IF;

  IF (NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: billing_exempt is set by the platform, not the organisation';
  END IF;

  -- NEW: the billing period anchor. Moving it forward suppresses invoicing
  -- entirely, so it is every bit as sensitive as billing_status.
  IF (NEW.usage_anchor IS DISTINCT FROM OLD.usage_anchor) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: usage_anchor is the billing period anchor, set by the platform';
  END IF;

  -- NEW: ownership. Repointing owner_id grants org visibility to an arbitrary
  -- user and redirects billing notices.
  IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: owner_id cannot be reassigned by the organisation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.prevent_billing_self_update IS
  'BEFORE UPDATE on organisations: freezes billing_status, billing_exempt, '
  'usage_anchor and owner_id against the tenant. organisations_update has no '
  'column list, so this trigger IS the column-level access control. Exempts the '
  'service role, superadmins and the app.internal_billing GUC.';

-- ------------------------------------------------------------
-- 2. ATOMIC OTP ATTEMPT ACCOUNTING (exploitable): the 5-guess budget was
--    bypassable by concurrency, making a 6-digit code brute-forceable.
--
-- Both verify functions did a read-modify-write:
--     read  attempts            (all concurrent requests see the same value)
--     ...
--     write attempts = read + 1 (all write the same number)
-- so N parallel requests advanced the counter by 1, not N. Neither verify
-- endpoint called check_otp_rate_limit either, so nothing else capped them. On
-- reset-password that is takeover of any owner whose phone number is known.
--
-- These RPCs make charge-then-check a SINGLE statement. `attempts = attempts + 1`
-- inside one UPDATE is atomic: concurrent writers block on the row lock and each
-- re-reads the committed value, so the count is exact. The attempt is charged
-- BEFORE the hash is compared, so a burst can never buy extra guesses.
--
-- Returns the live total so the caller decides; returns no row when there is no
-- usable challenge (caller reports 'expired' exactly as before).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_booking_otp_attempt(p_phone text)
 RETURNS TABLE (challenge_id uuid, code_hash text, attempts_used int)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id   uuid;
  v_hash text;
BEGIN
  UPDATE booking_verifications bv
     SET attempts = bv.attempts + 1
   WHERE bv.id = (
           SELECT id FROM booking_verifications
            WHERE phone = p_phone AND consumed_at IS NULL AND expires_at > now()
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
         )
  RETURNING bv.id, bv.code_hash INTO v_id, v_hash;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  -- Sum across every live challenge for the phone: requesting a fresh code must
  -- not hand back a fresh budget (the hardening 20260813 added to the old path).
  RETURN QUERY
    SELECT v_id, v_hash, coalesce(sum(bv.attempts), 0)::int
      FROM booking_verifications bv
     WHERE bv.phone = p_phone AND bv.consumed_at IS NULL AND bv.expires_at > now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_password_reset_attempt(p_phone text)
 RETURNS TABLE (challenge_id uuid, code_hash text, attempts_used int)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id   uuid;
  v_hash text;
BEGIN
  UPDATE password_reset_verifications pv
     SET attempts = pv.attempts + 1
   WHERE pv.id = (
           SELECT id FROM password_reset_verifications
            WHERE phone = p_phone AND consumed_at IS NULL AND expires_at > now()
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
         )
  RETURNING pv.id, pv.code_hash INTO v_id, v_hash;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_id, v_hash, coalesce(sum(pv.attempts), 0)::int
      FROM password_reset_verifications pv
     WHERE pv.phone = p_phone AND pv.consumed_at IS NULL AND pv.expires_at > now();
END;
$function$;

COMMENT ON FUNCTION public.claim_booking_otp_attempt IS
  'Atomically charges one guess against the newest live booking challenge and '
  'returns its hash plus the live attempt total. Replaces a read-modify-write in '
  'verify-booking-otp that concurrency could bypass, making the 6-digit code '
  'brute-forceable. Service-role only.';
COMMENT ON FUNCTION public.claim_password_reset_attempt IS
  'Password-reset twin of claim_booking_otp_attempt. Service-role only.';

-- The edge functions call these with the service role; nothing else may.
REVOKE ALL ON FUNCTION public.claim_booking_otp_attempt(text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_password_reset_attempt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_otp_attempt(text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_password_reset_attempt(text) TO service_role;

-- ------------------------------------------------------------
-- 3. GRANT HYGIENE (defence in depth; RLS blocks all of this today).
--
-- Supabase grants anon/authenticated ALL on new public tables by default, and
-- the older tables here never had that removed — so RLS is the ONLY barrier on
-- the most sensitive data in the system: platform_config holds the SMS provider
-- credentials and payment config, booking/password verifications hold OTP
-- hashes, org_payment_methods holds the card token, superadmins is the
-- privilege table. One accidental permissive policy away from a dump.
--
-- The newest migrations already do this (20260818120000, 20260819120000); these
-- tables predate the habit. All are service-role written and superadmin read —
-- verified nothing in client/src queries any of them directly.
-- ------------------------------------------------------------
REVOKE ALL ON public.platform_config               FROM anon, authenticated;
REVOKE ALL ON public.superadmins                   FROM anon, authenticated;
REVOKE ALL ON public.booking_verifications         FROM anon, authenticated;
REVOKE ALL ON public.password_reset_verifications  FROM anon, authenticated;

-- org_payment_methods: anon held table-level SELECT including the `token`
-- column that 20260724150000 was careful to hide from authenticated. Re-grant
-- authenticated exactly the display columns it had (token still excluded).
REVOKE ALL ON public.org_payment_methods FROM anon, authenticated;
GRANT SELECT (id, org_id, provider, last4, brand, expires_at, status, is_default, created_at)
  ON public.org_payment_methods TO authenticated;

-- ------------------------------------------------------------
-- 4. Migration 066's org_members column revoke was a NO-OP.
--
-- 066:139 did `REVOKE SELECT (user_id, role, ...) ON org_members FROM anon`
-- while anon still held TABLE-level SELECT — and a column-level revoke cannot
-- carve a subset out of a table-level grant. Verified on prod: anon reads all 12
-- columns today. The control everyone believed was in place has never existed.
--
-- Impact is latent rather than live: the policy is USING (is_bookable = true)
-- and every bookable row currently has user_id IS NULL (they are non-login staff
-- profiles). It activates the moment an owner marks themselves bookable, which
-- is the normal shape of a solo business.
--
-- Done correctly this time: drop the table grant FIRST, then grant back exactly
-- the six columns the public booking page reads
-- (Step2DateTimeSelect.tsx:113 selects id, display_name, title, is_bookable,
-- sort_order, avatar_url — verified against the query, not guessed).
--
-- `authenticated` is deliberately left alone: the dashboard and Team settings
-- need the full row.
-- ------------------------------------------------------------
REVOKE SELECT ON public.org_members FROM anon;
GRANT SELECT (id, display_name, title, is_bookable, sort_order, avatar_url)
  ON public.org_members TO anon;

-- ------------------------------------------------------------
-- 5. Dead SECURITY DEFINER functions still callable by anon.
--
-- All four verified to have zero callers across client/src and supabase/functions.
--   get_available_slots      — superseded by get_org_busy_slots; the 070 notes
--                              already listed it for deletion.
--   rls_auto_enable          — event-trigger helper, never a callable API.
--   sms_delivery_report      — superadmin-guarded internally, but exposing it
--                              buys nothing.
-- Kept as-is (checked each body): erase_customer_data, request_meeting_link_sms,
-- platform_stats and list_superadmins are also anon-granted but every one has a
-- correct internal guard, so anon already gets forbidden.
-- ------------------------------------------------------------
-- NOT has_verified_booking_otp — see the correction below.
REVOKE ALL ON FUNCTION public.get_available_slots(uuid, uuid, date)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable()                                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sms_delivery_report(timestamptz)                    FROM PUBLIC, anon, authenticated;

-- ⚠️ has_verified_booking_otp is deliberately NOT revoked, and the reason is a
-- correction worth recording: I first revoked it here and it BROKE ALL GUEST
-- BOOKING, caught by an attack test before it shipped.
--
-- An RLS policy expression is evaluated as the CALLING role, not as the table
-- owner. `customers_insert` (081) is
--     WITH CHECK (auth.uid() IS NOT NULL OR has_verified_booking_otp(phone_number))
-- so an anonymous customer needs EXECUTE on it for the policy to evaluate at
-- all; without it every booking failed with `permission denied for function`.
-- Granted to `authenticated` too, because Postgres does not guarantee OR
-- short-circuit order.
--
-- So it is not dead code: zero client callers, one load-bearing policy caller.
-- The residual (anon can probe whether a phone is mid-booking) is accepted — it
-- leaks far less than breaking every public booking would cost.
GRANT EXECUTE ON FUNCTION public.has_verified_booking_otp(text) TO anon, authenticated;

COMMENT ON FUNCTION public.has_verified_booking_otp IS
  'True when the phone holds a live verified, unconsumed OTP. Called from the '
  'customers_insert RLS policy, which is evaluated as the CALLING role — anon '
  'therefore REQUIRES EXECUTE here and revoking it breaks all guest booking.';

-- ------------------------------------------------------------
-- 6. Advisor WARN: pin the search_path on normalize_ge_phone (added with the
--    blocklist, 20260819120000). It touches no tables, so this is hygiene, but
--    an unpinned search_path on a function used inside a security predicate is
--    exactly the pattern 081 went through the codebase to remove.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_ge_phone(p_phone text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN d ~ '^[345][0-9]{8}$' THEN d
    ELSE NULL
  END
  FROM (
    SELECT regexp_replace(
             regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
             '^995', ''
           ) AS d
  ) s;
$function$;
