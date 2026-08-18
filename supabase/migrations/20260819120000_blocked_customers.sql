-- ============================================================
-- 20260819120000_blocked_customers.sql
--
-- Per-organisation customer blocklist: a business's last resort against a phone
-- number that abuses its booking page (serial no-shows, spam bookings, harassment).
--
-- SCOPE — deliberately narrow:
--   * A block is ORG-SCOPED. Blocking 555123456 at "Studio A" says nothing about
--     "Studio B"; there is no platform-wide ban here and no table that could
--     become one. Only a member of the org may add or remove its own entries.
--   * A block stops FUTURE bookings and RESCHEDULES. It does NOT touch the
--     customer's existing appointments — the business cancels or rejects those
--     from the dashboard if it wants to. Silently vaporising a paid booking on a
--     block would move money without anyone deciding to.
--   * A blocked customer may still CANCEL an existing appointment (and be
--     refunded per policy). Same reasoning as the billing block in
--     20260816120000: stranding someone with a booking they can neither move nor
--     cancel is worse than the leak it would close.
--
-- ENFORCEMENT is in the database, not the client. Every path that can create or
-- move a booking is gated, including the ones that run as the service role:
--
--   trg_zz_block_blocked_customer   BEFORE INSERT on appointments — the backstop.
--                                   NO exemption: not the service role (so the
--                                   payment webhook's online-booking insert is
--                                   covered), not superadmins, not the org's own
--                                   members. If the org blocked the number, the
--                                   number does not get an appointment row.
--   reschedule_appointment_slot     the /manage self-service move.
--   submit_review                   review-bombing is the same abuse by another
--                                   door, and reviews are keyed to an appointment
--                                   the blocked number owns.
--
-- Two edge functions refuse earlier so the business stops paying for an abuser:
-- request-booking-otp declines before generating or sending a code at all, and
-- create-payment declines before charging. Both are cost/UX shortcuts, not the
-- control — if either were bypassed the appointment insert would still hit the
-- trigger above (and the webhook would auto-refund).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Phone normalisation.
--
--    Numbers reach us in several shapes: customers.phone_number holds the bare
--    9-digit national form (010_phone_format), but a business typing into the
--    dashboard will paste "+995 555 10 85 09" or "995555108509". Normalise once,
--    here, so the blocklist and the customer record always compare equal.
--    Returns NULL for anything that is not a Georgian number — including the
--    '' anonymisation sentinel (076), so an erased customer is never "blocked".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_ge_phone(p_phone text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
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

COMMENT ON FUNCTION public.normalize_ge_phone IS
  'Georgian phone → bare 9-digit national form (strips punctuation and a 995 '
  'country code), or NULL when the input is not a valid Georgian number. NULL '
  'for the '''' anonymisation sentinel, so erased customers never match a block.';

-- ------------------------------------------------------------
-- 2. The blocklist.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  phone      text NOT NULL CHECK (phone ~ '^[345][0-9]{8}$'),
  -- Free-text note for the business's own records ("no-showed 4×"). Never shown
  -- to the customer — the booking page returns a neutral refusal.
  reason     text CHECK (reason IS NULL OR char_length(reason) <= 500),
  -- Who pressed the button. SET NULL rather than CASCADE: losing the staff
  -- account must not silently unblock anyone.
  blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (org_id, phone)
);

COMMENT ON TABLE public.blocked_customers IS
  'Per-org phone blocklist. A row means: this number may not create or reschedule '
  'a booking AT THIS ORG. Never platform-wide. Enforced by '
  'trg_zz_block_blocked_customer, reschedule_appointment_slot and submit_review.';

COMMENT ON COLUMN public.blocked_customers.phone IS
  'Bare 9-digit Georgian national number, normalised by trg_normalize_blocked_phone.';

-- The UNIQUE (org_id, phone) constraint is the lookup index too — is_phone_blocked
-- probes exactly that pair.

-- ------------------------------------------------------------
-- 3. Normalise on write.
--
--    So the dashboard can send whatever the user typed and the CHECK above still
--    holds. A number that cannot be normalised is rejected outright rather than
--    stored in a shape nothing will ever match.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_blocked_phone()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_phone text;
BEGIN
  v_phone := normalize_ge_phone(NEW.phone);
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'invalid_phone'
      USING HINT = 'blocked_customers.phone must be a Georgian number';
  END IF;
  NEW.phone := v_phone;
  NEW.reason := nullif(btrim(coalesce(NEW.reason, '')), '');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalize_blocked_phone ON public.blocked_customers;
CREATE TRIGGER trg_normalize_blocked_phone
  BEFORE INSERT OR UPDATE ON public.blocked_customers
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_blocked_phone();

-- ------------------------------------------------------------
-- 4. RLS — a block is the org's own list, readable and writable only by its
--    members. The WITH CHECK on org_id is load-bearing: without it any member
--    could insert rows against ANOTHER org's id and block that competitor's
--    customers.
--
--    No anon policy at all. The public booking page must never be able to read
--    (or probe) this table — that would turn it into a "is this number blocked
--    anywhere" oracle. Anonymous callers learn about a block only by attempting
--    a booking with a phone they have already proven they own via OTP.
-- ------------------------------------------------------------
ALTER TABLE public.blocked_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocked_customers_member_select" ON public.blocked_customers;
CREATE POLICY "blocked_customers_member_select"
  ON public.blocked_customers FOR SELECT
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

DROP POLICY IF EXISTS "blocked_customers_member_insert" ON public.blocked_customers;
CREATE POLICY "blocked_customers_member_insert"
  ON public.blocked_customers FOR INSERT
  WITH CHECK (org_id = ANY (get_user_org_ids()) OR is_superadmin());

DROP POLICY IF EXISTS "blocked_customers_member_update" ON public.blocked_customers;
CREATE POLICY "blocked_customers_member_update"
  ON public.blocked_customers FOR UPDATE
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin())
  WITH CHECK (org_id = ANY (get_user_org_ids()) OR is_superadmin());

DROP POLICY IF EXISTS "blocked_customers_member_delete" ON public.blocked_customers;
CREATE POLICY "blocked_customers_member_delete"
  ON public.blocked_customers FOR DELETE
  USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_customers TO authenticated;
REVOKE ALL ON public.blocked_customers FROM anon;

-- ------------------------------------------------------------
-- 5. The predicate every enforcement point shares.
--
--    SECURITY DEFINER so it reads past RLS for anonymous/guest callers, and
--    STABLE so it can sit inside other functions cheaply. NOT granted to anon or
--    authenticated: the dashboard reads the table directly under RLS, and an
--    anon-callable version would be the enumeration oracle the policies above
--    exist to prevent. The SECURITY DEFINER triggers below call it as their
--    owner, so no grant is needed for them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_phone_blocked(p_org_id uuid, p_phone text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM blocked_customers b
     WHERE b.org_id = p_org_id
       AND b.phone  = normalize_ge_phone(p_phone)
  );
$function$;

COMMENT ON FUNCTION public.is_phone_blocked IS
  'True when p_phone is on p_org_id''s blocklist. Org-scoped ONLY — never a '
  'platform-wide answer. False for an unnormalisable/erased phone. Service-role '
  'and internal use only: exposing it to anon would let anyone enumerate an '
  'org''s blocklist.';

REVOKE ALL ON FUNCTION public.is_phone_blocked(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_phone_blocked(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 6. The backstop: BEFORE INSERT on appointments.
--
--    Named trg_zz_… so it sorts LAST among the BEFORE INSERT guards, after
--    trg_enforce_booking_verification. That ordering is deliberate and is the
--    difference between a refusal and an oracle: appointments accepts anon
--    inserts, so if this fired first, anyone could POST a booking for any phone
--    and read 'customer_blocked' vs 'verification_required' to enumerate an
--    org's blocklist. Running last means only a caller who has already proven
--    they own the phone (verified OTP) ever sees this error. The wasted work of
--    the earlier guards on a blocked insert is the price, and it is small — the
--    whole statement rolls back, OTP consumption included.
--
--    Unlike normalize_guest_appointment, this has NO trusted-context exemption.
--    That is the whole point: the online booking path creates its appointment
--    from payment-webhook under the service role, so exempting the service role
--    would leave the blocklist enforcing nothing but on-site bookings. The
--    webhook already handles a failed insert by auto-refunding the charge, so a
--    blocked customer who somehow reaches checkout gets their money straight
--    back rather than a booking.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_customer_not_blocked()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_phone text;
BEGIN
  SELECT c.phone_number INTO v_phone
    FROM customers c WHERE c.id = NEW.customer_id;

  -- No customer row / no usable phone: nothing to match. The FK plus
  -- enforce_booking_verification already reject that case on the guest path.
  IF v_phone IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_phone_blocked(NEW.org_id, v_phone) THEN
    RAISE EXCEPTION 'customer_blocked'
      USING HINT = 'this phone is on the organisation''s blocklist';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_customer_not_blocked IS
  'BEFORE INSERT on appointments: refuses a booking whose customer phone is on '
  'the target org''s blocklist. Applies to EVERY caller including the service '
  'role (payment-webhook) and superadmins — the blocklist has no trusted '
  'bypass. Raises ''customer_blocked''.';

DROP TRIGGER IF EXISTS trg_zz_block_blocked_customer ON public.appointments;
CREATE TRIGGER trg_zz_block_blocked_customer
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_customer_not_blocked();

-- ------------------------------------------------------------
-- 7. reschedule_appointment_slot — supersedes 20260816120000.
--
--    Rescheduling is an UPDATE, so the trigger above never fires for it. Without
--    this a blocked customer keeps the one booking they have and walks it
--    forward forever. Cancelling stays open (see the header).
--
--    Everything else is unchanged from 20260816120000; the SELECT now joins
--    customers to get the phone.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_appointment_slot(p_appointment_id uuid, p_scheduled_at timestamp with time zone, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id     uuid;
  v_service_id uuid;
  v_duration   int;
  v_status     text;
  v_phone      text;
  v_start      timestamptz := p_scheduled_at;
  v_end        timestamptz;
  v_cap        int;
  v_overlaps   int;
BEGIN
  SELECT a.org_id, a.service_id, a.duration_minutes, a.status, c.phone_number
    INTO v_org_id, v_service_id, v_duration, v_status, v_phone
    FROM appointments a
    LEFT JOIN customers c ON c.id = a.customer_id
   WHERE a.id = p_appointment_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'not_reschedulable';
  END IF;

  -- Blocklist gate: a blocked number may not move its booking to a new slot.
  -- Cancelling is deliberately still allowed (manage-appointment does that
  -- without this RPC).
  IF is_phone_blocked(v_org_id, v_phone) THEN
    RAISE EXCEPTION 'customer_blocked';
  END IF;

  -- Billing gate: an unpaid org may not gain a booking on a new date. Fails
  -- closed — a NULL (org vanished mid-flight) blocks rather than allows.
  IF NOT coalesce(org_can_accept_appointment(v_org_id), false) THEN
    RAISE EXCEPTION 'billing_blocked';
  END IF;

  -- Availability guard (defence in depth): reject a reschedule to a closed day,
  -- out-of-hours or past time even if the caller crafts the request directly.
  IF NOT booking_time_available(v_org_id, p_scheduled_at, v_duration) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  v_end := v_start + make_interval(mins => v_duration);

  PERFORM pg_advisory_xact_lock(hashtext(v_org_id::text));

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_members mem
      JOIN service_staff ss ON ss.member_id = mem.id AND ss.service_id = v_service_id
     WHERE mem.id = p_staff_id AND mem.org_id = v_org_id AND mem.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  SELECT s.max_per_slot INTO v_cap FROM services s WHERE s.id = v_service_id;
  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = v_org_id
     AND a.service_id = v_service_id
     AND a.id <> p_appointment_id
     AND a.status NOT IN ('rejected', 'cancelled')
     AND a.scheduled_at > v_start - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start;
  IF v_overlaps >= coalesce(v_cap, 1) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  IF p_staff_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.org_id = v_org_id
       AND a.staff_id = p_staff_id
       AND a.id <> p_appointment_id
       AND a.status NOT IN ('rejected', 'cancelled')
       AND a.scheduled_at > v_start - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  UPDATE appointments
     SET scheduled_at = v_start,
         staff_id     = p_staff_id,
         updated_at   = now()
   WHERE id = p_appointment_id;
END;
$function$;

COMMENT ON FUNCTION public.reschedule_appointment_slot IS
  'Moves an appointment to a new slot, re-validating the org blocklist, billing, '
  'working hours, capacity + staff under the per-org advisory lock (excluding the '
  'moved row). Service-role only; the OTP gate is in the manage-appointment edge '
  'fn. Raises not_found | not_reschedulable | customer_blocked | billing_blocked | '
  'slot_taken | staff_not_available.';

REVOKE ALL ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment_slot(uuid, timestamptz, uuid) TO service_role;

-- ------------------------------------------------------------
-- 8. submit_review — supersedes 068.
--
--    A blocked number keeps its completed appointments, and each of those is a
--    review capability. Leaving reviews open would hand the abusive customer the
--    loudest channel the org has right after it shut the quiet one. Existing
--    reviews are untouched: a block is not retroactive censorship, it just stops
--    new writes.
--
--    Returns the same { ok, error } jsonb shape as the rest of the function.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review(
  p_appointment_id uuid,
  p_rating         smallint,
  p_comment        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id  uuid;
  v_status  text;
  v_enabled boolean;
  v_name    text;
  v_phone   text;
  v_comment text;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rating');
  END IF;

  SELECT a.org_id, a.status::text, o.reviews_enabled, c.first_name, c.phone_number
    INTO v_org_id, v_status, v_enabled, v_name, v_phone
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  LEFT JOIN customers c ON c.id = a.customer_id
  WHERE a.id = p_appointment_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reviews_disabled');
  END IF;
  IF v_status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_completed');
  END IF;
  -- Blocked at this org → no new review. Reported as 'not_found' rather than a
  -- distinct code: the review page is reachable by anyone holding the
  -- appointment UUID, so a specific answer here would leak the org's blocklist
  -- to whoever has the link.
  IF is_phone_blocked(v_org_id, v_phone) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Trim + cap the free-text comment; empty becomes NULL.
  v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');
  IF v_comment IS NOT NULL AND char_length(v_comment) > 1000 THEN
    v_comment := left(v_comment, 1000);
  END IF;

  INSERT INTO reviews (org_id, appointment_id, rating, comment, author_name)
  VALUES (v_org_id, p_appointment_id, p_rating, v_comment, v_name)
  ON CONFLICT (appointment_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_reviewed');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, smallint, text) TO anon, authenticated;
