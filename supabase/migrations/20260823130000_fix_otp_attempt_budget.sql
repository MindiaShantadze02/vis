-- Fixes the attempt-budget semantics introduced hours earlier in
-- 20260823120000_security_hardening.sql. That migration made the attempt
-- counter atomic (correct, and the point of the change) but computed the budget
-- as sum(attempts) over EVERY live challenge for the phone — including ones
-- that had already been verified successfully.
--
-- Why that is wrong: nothing consumes a challenge on the login/register path
-- (only the booking insert trigger sets consumed_at), so every successful sign
-- in leaves a verified row behind for the rest of its 10-minute TTL, each
-- carrying the one attempt its own verification cost. Six logins inside ten
-- minutes therefore pushed the sum past MAX_ATTEMPTS and locked the phone out
-- of a code it had just been sent. Observed live: 7 live rows / 19 summed
-- attempts for the seed phone, and every logging-in e2e spec failing with
-- too_many_attempts on a freshly issued code.
--
-- The budget now counts only challenges that have NOT been verified — i.e. only
-- actual failed guesses. The anti-brute-force property is untouched: an
-- attacker's guesses never verify, so they always accumulate, and requesting a
-- fresh code does NOT buy a fresh budget while the old challenges are live.
--
-- The row to charge is chosen as "newest unverified, else newest" so that
-- re-verifying an already-verified code still works — a reachable path, since
-- Step3CustomerForm keeps the Verify button as the retry after a booking insert
-- fails downstream of a successful verify. That row is still charged, so
-- hammering a verified challenge stays bounded too.

CREATE OR REPLACE FUNCTION public.claim_booking_otp_attempt(p_phone text)
 RETURNS TABLE (challenge_id uuid, code_hash text, attempts_used int)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; v_hash text;
BEGIN
  UPDATE booking_verifications bv
     SET attempts = bv.attempts + 1
   WHERE bv.id = (
           SELECT id FROM booking_verifications
            WHERE phone = p_phone AND consumed_at IS NULL AND expires_at > now()
            ORDER BY (verified_at IS NULL) DESC, created_at DESC
            LIMIT 1 FOR UPDATE
         )
  RETURNING bv.id, bv.code_hash INTO v_id, v_hash;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT v_id, v_hash, coalesce(sum(bv.attempts), 0)::int
      FROM booking_verifications bv
     WHERE bv.phone = p_phone
       AND bv.consumed_at IS NULL
       AND bv.expires_at > now()
       AND (bv.verified_at IS NULL OR bv.id = v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_password_reset_attempt(p_phone text)
 RETURNS TABLE (challenge_id uuid, code_hash text, attempts_used int)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; v_hash text;
BEGIN
  UPDATE password_reset_verifications pv
     SET attempts = pv.attempts + 1
   WHERE pv.id = (
           SELECT id FROM password_reset_verifications
            WHERE phone = p_phone AND consumed_at IS NULL AND expires_at > now()
            ORDER BY (verified_at IS NULL) DESC, created_at DESC
            LIMIT 1 FOR UPDATE
         )
  RETURNING pv.id, pv.code_hash INTO v_id, v_hash;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT v_id, v_hash, coalesce(sum(pv.attempts), 0)::int
      FROM password_reset_verifications pv
     WHERE pv.phone = p_phone
       AND pv.consumed_at IS NULL
       AND pv.expires_at > now()
       AND (pv.verified_at IS NULL OR pv.id = v_id);
END;
$function$;

COMMENT ON FUNCTION public.claim_booking_otp_attempt IS
  'Atomically charges one verification attempt against the phone''s live '
  'challenges and returns the challenge to compare plus the attempts used so '
  'far. Budget counts UNVERIFIED live challenges only, so successful sign-ins '
  'do not erode it while wrong guesses accumulate across re-requests. '
  'Service-role only.';

-- Marking a booking challenge verified also REFUNDS the attempt that the claim
-- charged for it. Charging before the hash compare is what closes the
-- concurrency race, but the charge is only meant to price a *guess* — a correct
-- code should cost nothing. Without the refund, logging in repeatedly inside
-- the 60s resend cooldown re-verifies the same still-live challenge (the client
-- gets 'too_soon' and no new code is issued), so a legitimate user walked their
-- own budget to zero in five sign-ins and locked themselves out.
--
-- Wrong guesses are never refunded, so the brute-force bound is unchanged.
CREATE OR REPLACE FUNCTION public.mark_booking_otp_verified(p_id uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  UPDATE booking_verifications
     SET verified_at = coalesce(verified_at, now()),
         attempts    = greatest(attempts - 1, 0)
   WHERE id = p_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_booking_otp_verified(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_otp_verified(uuid) TO service_role;
