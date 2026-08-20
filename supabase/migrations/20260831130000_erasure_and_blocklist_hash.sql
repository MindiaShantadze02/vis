-- ============================================================
-- 20260831130000_erasure_and_blocklist_hash.sql
-- Applied to cloud as: blocklist_phone_hash, blocked_phone_allow_erased,
--                      complete_customer_erasure (2026-08-20)
--
-- Article 16: "erased" was not erased (docs/COMPLIANCE_GE_DPL.md, finding G5).
-- erase_customer_data updated only `appointments` (notes) and `customers`
-- (name/phone), leaving the person's number in sms_log (4,783 rows), their NAME
-- in notifications (432 rows, no retention at all), plus reviews,
-- blocked_customers and pending_bookings.
--
-- Blocklist entries were the awkward case: keeping a readable number forever
-- collided with erasure, but deleting the entry would hand an abusive caller a
-- reset button. Resolved by storing a PEPPERED HASH — the block still matches,
-- and after an erasure there is no readable number left to disclose.
-- ============================================================

-- ── Peppered phone hash ──────────────────────────────────────────────────
-- A bare SHA-256 of a 9-digit number is brute-forceable in seconds, so the
-- pepper is doing the actual work. It lives in platform_config, which anon and
-- authenticated cannot read (20260819073759 revoked those grants).
ALTER TABLE platform_config
  ADD COLUMN IF NOT EXISTS phone_hash_pepper text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex');

ALTER TABLE blocked_customers
  ADD COLUMN IF NOT EXISTS phone_hash text;

-- phone becomes optional: erasure clears it and leaves the hash behind.
ALTER TABLE blocked_customers ALTER COLUMN phone DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.hash_phone(p_phone text)
  RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public','extensions','pg_temp'   -- pgcrypto lives in `extensions`
AS $function$
DECLARE v_local text; v_pepper text;
BEGIN
  v_local := normalize_ge_phone(p_phone);
  IF v_local IS NULL THEN RETURN NULL; END IF;
  SELECT phone_hash_pepper INTO v_pepper FROM platform_config WHERE id = 1;
  RETURN encode(digest(v_local || coalesce(v_pepper, ''), 'sha256'), 'hex');
END;
$function$;

REVOKE ALL ON FUNCTION public.hash_phone(text) FROM PUBLIC, anon, authenticated;

UPDATE blocked_customers SET phone_hash = hash_phone(phone)
 WHERE phone_hash IS NULL AND phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_blocked_customer_hash()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone      := normalize_ge_phone(NEW.phone);
    NEW.phone_hash := hash_phone(NEW.phone);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_blocked_customer_hash ON blocked_customers;
CREATE TRIGGER trg_set_blocked_customer_hash
  BEFORE INSERT OR UPDATE OF phone ON blocked_customers
  FOR EACH ROW EXECUTE FUNCTION set_blocked_customer_hash();

CREATE INDEX IF NOT EXISTS idx_blocked_customers_hash ON blocked_customers (org_id, phone_hash);

-- normalize_blocked_phone rejected a NULL phone outright — right when a business
-- is CREATING a block, wrong once erasure exists. Refuse NULL only when there is
-- no hash to fall back on: still no block that identifies nobody, but an erased
-- one is allowed.
CREATE OR REPLACE FUNCTION public.normalize_blocked_phone()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_phone text;
BEGIN
  NEW.reason := nullif(btrim(coalesce(NEW.reason, '')), '');

  IF NEW.phone IS NULL THEN
    IF NEW.phone_hash IS NULL THEN
      RAISE EXCEPTION 'invalid_phone'
        USING HINT = 'blocked_customers needs either a Georgian number or a phone_hash';
    END IF;
    RETURN NEW;
  END IF;

  v_phone := normalize_ge_phone(NEW.phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'invalid_phone'
      USING HINT = 'blocked_customers.phone must be a Georgian number';
  END IF;
  NEW.phone := v_phone;
  RETURN NEW;
END;
$function$;

-- Match on the hash so a block survives erasure. Falls back to plaintext for any
-- row predating the backfill.
CREATE OR REPLACE FUNCTION public.is_phone_blocked(p_org_id uuid, p_phone text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM blocked_customers b
     WHERE b.org_id = p_org_id
       AND (
         b.phone_hash = hash_phone(p_phone)
         OR (b.phone_hash IS NULL AND b.phone = normalize_ge_phone(p_phone))
       )
  );
$function$;

COMMENT ON COLUMN blocked_customers.phone_hash IS
  'Peppered SHA-256 of the normalised number. The block matches on this, so an '
  'Article 16 erasure can null out `phone` without unblocking the person.';

-- ── Erasure that actually erases ─────────────────────────────────────────
-- Every statement is scoped to the appointment's org: a business must not be
-- able to reach another tenant's data through an appointment id it owns.
CREATE OR REPLACE FUNCTION public.erase_customer_data(p_appointment_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org_id      uuid;
  v_customer_id uuid;
  v_phone       text;
BEGIN
  SELECT a.org_id, a.customer_id, c.phone_number
    INTO v_org_id, v_customer_id, v_phone
    FROM appointments a
    LEFT JOIN customers c ON c.id = a.customer_id
   WHERE a.id = p_appointment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;

  IF NOT (v_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 1. The appointment's free text (may itself name or describe the person).
  UPDATE appointments
     SET notes = NULL, admin_notes = NULL
   WHERE id = p_appointment_id;

  -- 2. Notifications naming them. appointment_id makes this exact — the body is
  --    "Name · Service", so scrubbing by name match would be guesswork.
  DELETE FROM notifications
   WHERE appointment_id = p_appointment_id;

  IF v_customer_id IS NOT NULL THEN
    -- 3. The customer record itself.
    UPDATE customers
       SET first_name = 'erased',
           last_name  = NULL,
           phone_number = '',
           consent_accepted_at = NULL,
           consent_version = NULL
     WHERE id = v_customer_id;

    -- 4. Reviews they left for THIS org. Keep `rating` so the business's average
    --    is not silently rewritten by an erasure; drop the name and free text.
    UPDATE reviews r
       SET author_name = 'erased', comment = NULL
      FROM appointments a
     WHERE r.appointment_id = a.id
       AND a.customer_id = v_customer_id
       AND r.org_id = v_org_id;
  END IF;

  IF v_phone IS NOT NULL AND v_phone <> '' THEN
    -- 5. Delivery log: keep the row (it is the SMS audit trail and feeds ops
    --    stats) but drop the identifier.
    UPDATE sms_log
       SET recipient_phone = ''
     WHERE recipient_phone = v_phone
       AND (org_id = v_org_id OR org_id IS NULL);

    -- 6. Parked, unconsumed bookings — no value, delete outright.
    DELETE FROM pending_bookings
     WHERE phone = v_phone AND org_id = v_org_id;

    -- 7. Blocklist: drop the readable number, keep phone_hash so the block still
    --    holds. Erasure must not double as a way to get unblocked.
    UPDATE blocked_customers
       SET phone = NULL
     WHERE org_id = v_org_id AND phone = v_phone;
  END IF;

  -- Erasure is itself a processing action worth recording (Art. 27).
  PERFORM log_data_access('erase_customer_data', v_org_id,
    jsonb_build_object('appointment_id', p_appointment_id));
END;
$function$;

COMMENT ON FUNCTION public.erase_customer_data IS
  'Article 16 erasure for the customer behind one appointment: scrubs the '
  'customer row, appointment notes, their review, the SMS delivery log '
  'identifier, parked bookings, and the readable number on any blocklist entry '
  '(the hash is kept so the block survives). Org-scoped and logged.';
