-- ============================================================
-- 20260822120000_readd_pending_approval.sql
--
-- Brings back the pending-approval workflow that 20260814120000 deleted, but
-- NARROWER than the original and with a billing rule it never had.
--
-- Scope — approval applies to ON-SITE payments only:
--   * paid online     → the money already moved, nothing to vet → auto-approved
--   * deposit taken   → same → auto-approved
--   * on-site / ₾0    → the business may want to vet it → 'pending' when the
--                       org has opted in
-- This falls out of WHERE the gate sits rather than needing its own branching:
-- normalize_guest_appointment only ever runs for an untrusted guest insert (the
-- online path is created by payment-webhook as the service role, which returns
-- early), and it already raises 'deposit_required' before the status is pinned.
-- So by the time we choose a status we are guaranteed guest + on-site + no
-- deposit — exactly the set that should be gated.
--
-- Opt-IN: organisations.require_approval defaults to FALSE. Note this is the
-- opposite of migration 080, which had flipped the old column's default to
-- true. Every business auto-approves until it turns approval on.
--
-- A pending request does NOT hold the slot (a deliberate product decision):
-- someone else can still book that time. The cost is that approving has to
-- re-check capacity and can fail — see approve_appointment below.
--
-- ── What this migration deliberately does NOT touch ──────────────────────────
--
-- BILLING. The rule "Vis only charges once the owner approves" is already
-- satisfied: close_billing_period_for_org (20260817120000) and
-- get_org_billing_status (20260804160000) both count
-- status IN ('approved','completed','no_show'), and 'pending' is not in that
-- set. A request that is never approved is never billed, with no new code.
--   The one theoretical hole — close_billing_period_for_org closes each period
--   exactly once (ON CONFLICT DO NOTHING + RETURN NULL), so a row that becomes
--   billable after its period closed could never be picked up — is closed by
--   reject_elapsed_pending_appointments below: periods close the day AFTER they
--   end, by which point every pending row inside them has passed its slot time
--   and been rejected.
--
-- THE CONFIRMATION SMS. send_appointment_sms (20260813130000) already has a
-- live UPDATE arm firing on `NEW.status='approved' AND OLD.status IS DISTINCT
-- FROM 'approved'`. It has sat dormant with no producer since the removal;
-- re-adding 'pending' makes it fire again. Only the *rejection* arm is new.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The opt-in flag.
-- ------------------------------------------------------------
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organisations.require_approval IS
  'When true, ON-SITE guest bookings land ''pending'' and wait for an owner to '
  'approve; online/deposit bookings are unaffected (always auto-approved). '
  'Defaults to FALSE — auto-approve — unlike the pre-2026-08-14 column, whose '
  'default migration 080 had flipped to true.';

-- ------------------------------------------------------------
-- 2. Re-widen the two CHECK constraints the removal narrowed.
-- ------------------------------------------------------------
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed', 'no_show'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_appointment', 'pending_approval', 'appointment_cancelled', 'billing_notice'));

-- ------------------------------------------------------------
-- 3. Pending rows are transient, so a PARTIAL index stays tiny while serving
--    both the pending-first sort and the cron sweep below.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_pending
  ON public.appointments (org_id, scheduled_at)
  WHERE status = 'pending';

-- ------------------------------------------------------------
-- 4. normalize_guest_appointment — supersedes 20260817140000.
--
--    Body is that version verbatim (deposit resolution + the in_person_not_allowed
--    guard) with two changes: the org SELECT also reads require_approval, and the
--    hard-coded status is now derived. Everything before the status pin is
--    untouched, which is what keeps the online/deposit paths auto-approved.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_guest_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_duration int;
  v_price    numeric;
  v_s_dtype  text;
  v_s_dval   numeric;
  v_o_dtype  text;
  v_o_dval   numeric;
  v_dtype    text;
  v_dval     numeric;
  v_deposit  numeric;
  v_onsite   boolean;
  v_approval boolean;
BEGIN
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  SELECT s.duration_minutes, s.price, s.deposit_type, s.deposit_value
    INTO v_duration, v_price, v_s_dtype, v_s_dval
    FROM services s
   WHERE s.id = NEW.service_id AND s.org_id = NEW.org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;
  NEW.duration_minutes := v_duration;

  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM service_staff ss
      JOIN org_members m ON m.id = ss.member_id
     WHERE ss.service_id = NEW.service_id
       AND ss.member_id = NEW.staff_id
       AND m.is_bookable
  ) THEN
    RAISE EXCEPTION 'staff_not_available';
  END IF;

  SELECT o.deposit_type,
         o.deposit_value,
         COALESCE((o.payment_config -> 'in_person' ->> 'enabled')::boolean, true),
         o.require_approval
    INTO v_o_dtype, v_o_dval, v_onsite, v_approval
    FROM organisations o WHERE o.id = NEW.org_id;

  IF v_s_dtype IS NOT NULL THEN
    v_dtype := v_s_dtype; v_dval := v_s_dval;
  ELSE
    v_dtype := v_o_dtype; v_dval := v_o_dval;
  END IF;

  v_deposit := CASE
    WHEN v_dtype IS NULL OR v_dtype = 'none' OR v_dval IS NULL THEN 0
    WHEN v_dtype = 'fixed'   THEN least(round(v_dval, 2), round(coalesce(v_price, 0), 2))
    WHEN v_dtype = 'percent' THEN least(round(coalesce(v_price, 0) * v_dval / 100, 2), round(coalesce(v_price, 0), 2))
    ELSE 0
  END;

  -- A deposit forces the online path, so anything reaching here has none —
  -- which is why deposit bookings are never gated on approval.
  IF v_deposit > 0 THEN
    RAISE EXCEPTION 'deposit_required';
  END IF;

  -- A ₾0 service has no other way to check out, so it stays bookable even for
  -- an online-only business (create-payment rejects a zero amount outright).
  IF NOT v_onsite AND COALESCE(v_price, 0) > 0 THEN
    RAISE EXCEPTION 'in_person_not_allowed';
  END IF;

  -- The gate. Fails SAFE: a missed org lookup leaves v_approval NULL and the
  -- booking is auto-approved, matching the column default rather than trapping
  -- a customer in a queue the owner may not be watching.
  NEW.status            := CASE WHEN coalesce(v_approval, false) THEN 'pending' ELSE 'approved' END;
  NEW.payment_status    := 'unpaid';
  NEW.payment_method    := 'in_person';
  NEW.payment_provider  := NULL;
  NEW.payment_reference := NULL;
  NEW.admin_notes       := NULL;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.normalize_guest_appointment IS
  'BEFORE INSERT on appointments: pins status/payment_*/admin_notes for untrusted '
  '(guest) inserts and refuses a deposit service or an on-site booking at an '
  'online-only org. Since 20260822120000 the status is ''pending'' when the org '
  'has require_approval on — only reachable on the on-site path, so online and '
  'deposit bookings stay auto-approved. Exempts service role, superadmins and '
  'members of the target org.';

-- ------------------------------------------------------------
-- 5. notify_new_appointment — restores the pending_approval branch that
--    021_appointment_notifications_guard had and 20260814120000 flattened.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name text;
  v_service_name  text;
BEGIN
  -- Skip only when an admin of THIS org created the appointment themselves.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id
      AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
    INTO v_customer_name
    FROM customers c
   WHERE c.id = NEW.customer_id;

  SELECT s.name
    INTO v_service_name
    FROM services s
   WHERE s.id = NEW.service_id;

  -- A failure here must never roll back the booking itself.
  BEGIN
    INSERT INTO notifications (org_id, user_id, type, appointment_id, title, body)
    SELECT
      NEW.org_id,
      m.user_id,
      CASE WHEN NEW.status = 'pending' THEN 'pending_approval' ELSE 'new_appointment' END,
      NEW.id,
      CASE WHEN NEW.status = 'pending' THEN 'ახალი ჯავშნის მოთხოვნა' ELSE 'ახალი ჯავშანი' END,
      concat_ws(' · ', v_customer_name, v_service_name)
    FROM org_members m
    WHERE m.org_id = NEW.org_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_new_appointment failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 6. send_appointment_sms — supersedes 20260813130000.
--
--    The approved arm is unchanged (it was already the pending → approved hook,
--    dormant since the removal). NEW: pending → rejected texts the customer that
--    their request was declined, because silence would leave someone who asked
--    for a time assuming they got it.
--
--    `auth.uid() IS NOT NULL` is what keeps the nightly sweep silent: a human
--    rejecting from the dashboard has a JWT, pg_cron does not. Nobody wants an
--    SMS telling them a request they forgot about has expired.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_appointment_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url    text;
  v_secret text;
  v_send   boolean := false;
  v_type   text    := 'booking_confirmation';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved'
       AND NOT (auth.uid() IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_members m
                   WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()))
    THEN
      v_send := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      v_send := true;
    ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' AND auth.uid() IS NOT NULL THEN
      v_send := true;
      v_type := 'approval_update';
    END IF;
  END IF;

  IF NOT v_send THEN
    RETURN NEW;
  END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;

  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := jsonb_build_object('appointment_id', NEW.id, 'message_type', v_type),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_appointment_sms failed for appointment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.send_appointment_sms IS
  'Sends ONE booking_confirmation when a booking reaches ''approved'' (at insert '
  'for auto-approved bookings, at the approving UPDATE otherwise), and one '
  'approval_update when a HUMAN rejects a pending request. The nightly '
  'auto-reject sweep is silent (no auth.uid()). Every other appointment write '
  '(cancel, no-show, notes, meeting link, auto-complete) is silent.';

-- ------------------------------------------------------------
-- 7. Pending must NOT hold the slot.
--
--    Every capacity/availability filter is written as
--    `status NOT IN ('rejected','cancelled')`; each one now also excludes
--    'pending', so a request in the queue leaves the time bookable by someone
--    else. The trade-off is handled in approve_appointment.
-- ------------------------------------------------------------

-- 7a. get_org_busy_slots — supersedes 066. Drives the public booking page's
--     greyed-out slots.
CREATE OR REPLACE FUNCTION public.get_org_busy_slots(
  p_org_id uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
RETURNS TABLE(scheduled_at timestamptz, duration_minutes int, service_id uuid, staff_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.scheduled_at, a.duration_minutes::int, a.service_id, a.staff_id
  FROM appointments a
  WHERE a.org_id = p_org_id
    AND a.scheduled_at >= p_from
    AND a.scheduled_at <= p_to
    AND a.status NOT IN ('rejected','cancelled','pending');
$$;

COMMENT ON FUNCTION public.get_org_busy_slots IS
  'Busy time-ranges (no PII) for one org in a window, for public availability '
  'computation. Definer + org-scoped so anon cannot enumerate other orgs (MED-3). '
  'Excludes ''pending'' since 20260822120000: an unapproved request does not '
  'hold the slot.';

-- 7b. enforce_slot_capacity — supersedes 20260817150000. Body identical bar the
--     two status filters.
CREATE OR REPLACE FUNCTION public.enforce_slot_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap      int;
  v_start    timestamptz;
  v_end      timestamptz;
  v_overlaps int;
BEGIN
  IF auth.role() = 'service_role'
     OR is_superadmin()
     OR (auth.uid() IS NOT NULL AND NEW.org_id = ANY (get_user_org_ids())) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.org_id::text));

  v_start := NEW.scheduled_at;
  v_end   := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);

  SELECT s.max_per_slot INTO v_cap
    FROM services s
   WHERE s.id = NEW.service_id;

  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = NEW.org_id
     AND a.service_id = NEW.service_id
     AND a.status NOT IN ('rejected', 'cancelled', 'pending')
     AND a.scheduled_at > v_start - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start;

  IF v_overlaps >= coalesce(v_cap, 1) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  IF NEW.staff_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM appointments a
     WHERE a.org_id = NEW.org_id
       AND a.staff_id = NEW.staff_id
       AND a.status NOT IN ('rejected', 'cancelled', 'pending')
       AND a.scheduled_at > v_start - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  RETURN NEW;
END;
$$;

-- 7c. org_usage — supersedes 059. Superadmin display only, but its NEGATIVE
--     status list would otherwise silently start counting unapproved requests.
CREATE OR REPLACE FUNCTION public.org_usage(p_org_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::int
    FROM appointments a
    JOIN organisations o ON o.id = a.org_id
   WHERE a.org_id = p_org_id
     AND a.status NOT IN ('rejected', 'cancelled', 'pending')
     AND a.created_at >= current_period_start(o.usage_anchor);
$$;

-- ------------------------------------------------------------
-- 8. search_appointments — supersedes 20260814120000.
--    Restores the pending-first ordering from 014_pending_first_ordering: the
--    owner's queue belongs at the top of the list. Body otherwise identical.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_appointments(
  p_org_id         uuid,
  p_status         text        DEFAULT NULL,
  p_search         text        DEFAULT NULL,
  p_date_from      timestamptz DEFAULT NULL,
  p_date_to        timestamptz DEFAULT NULL,
  p_service_id     uuid        DEFAULT NULL,
  p_staff_id       uuid        DEFAULT NULL,
  p_payment_status text        DEFAULT NULL,
  p_limit          int         DEFAULT 100,
  p_offset         int         DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  scheduled_at     timestamptz,
  duration_minutes int2,
  service_id       uuid,
  staff_id         uuid,
  status           text,
  payment_method   text,
  payment_status   text,
  notes            text,
  admin_notes      text,
  meeting_link     text,
  customers        jsonb,
  services         jsonb,
  staff            jsonb,
  total_count      bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    a.scheduled_at,
    a.duration_minutes,
    a.service_id,
    a.staff_id,
    a.status,
    a.payment_method,
    a.payment_status,
    a.notes,
    a.admin_notes,
    a.meeting_link,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'first_name',   c.first_name,
      'last_name',    c.last_name,
      'phone_number', c.phone_number
    ) END AS customers,
    CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name',             s.name,
      'price',            s.price,
      'duration_minutes', s.duration_minutes,
      'location_type',    s.location_type
    ) END AS services,
    CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',           m.id,
      'display_name', m.display_name,
      'title',        m.title
    ) END AS staff,
    count(*) OVER() AS total_count
  FROM appointments a
  LEFT JOIN customers   c ON c.id = a.customer_id
  LEFT JOIN services    s ON s.id = a.service_id
  LEFT JOIN org_members m ON m.id = a.staff_id
  WHERE a.org_id = p_org_id
    AND (p_status         IS NULL OR a.status = p_status)
    AND (p_service_id     IS NULL OR a.service_id = p_service_id)
    AND (p_staff_id       IS NULL OR a.staff_id = p_staff_id)
    AND (p_payment_status IS NULL OR a.payment_status = p_payment_status)
    AND (p_date_from      IS NULL OR a.scheduled_at >= p_date_from)
    AND (p_date_to        IS NULL OR a.scheduled_at <= p_date_to)
    AND (
      p_search IS NULL OR p_search = '' OR
      c.first_name   ILIKE '%' || p_search || '%' OR
      c.last_name    ILIKE '%' || p_search || '%' OR
      c.phone_number ILIKE '%' || p_search || '%' OR
      s.name         ILIKE '%' || p_search || '%'
    )
  ORDER BY (a.status = 'pending') DESC, a.scheduled_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- ------------------------------------------------------------
-- 9. approve_appointment — the owner's approve action.
--
--    Needed as an RPC rather than a plain UPDATE precisely BECAUSE a pending
--    request does not hold its slot: between the request and the approval,
--    somebody else may have booked that time. So this re-runs the same capacity
--    and staff checks as reschedule_appointment_slot, under the same per-org
--    advisory lock, and refuses with 'slot_taken' rather than letting the owner
--    create a double booking with one click.
--
--    Rejection needs no RPC — it is a plain status UPDATE already permitted by
--    the appointments_member_update policy.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_appointment(p_appointment_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id     uuid;
  v_service_id uuid;
  v_staff_id   uuid;
  v_duration   int;
  v_status     text;
  v_start      timestamptz;
  v_end        timestamptz;
  v_cap        int;
  v_overlaps   int;
BEGIN
  SELECT a.org_id, a.service_id, a.staff_id, a.duration_minutes, a.status, a.scheduled_at
    INTO v_org_id, v_service_id, v_staff_id, v_duration, v_status, v_start
    FROM appointments a WHERE a.id = p_appointment_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF NOT (v_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending';
  END IF;

  v_end := v_start + make_interval(mins => v_duration);

  PERFORM pg_advisory_xact_lock(hashtext(v_org_id::text));

  -- Per-service capacity, excluding this row and any other still-pending
  -- request (only confirmed bookings consume the slot).
  SELECT s.max_per_slot INTO v_cap FROM services s WHERE s.id = v_service_id;
  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = v_org_id
     AND a.service_id = v_service_id
     AND a.id <> p_appointment_id
     AND a.status NOT IN ('rejected', 'cancelled', 'pending')
     AND a.scheduled_at > v_start - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start;
  IF v_overlaps >= coalesce(v_cap, 1) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  IF v_staff_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.org_id = v_org_id
       AND a.staff_id = v_staff_id
       AND a.id <> p_appointment_id
       AND a.status NOT IN ('rejected', 'cancelled', 'pending')
       AND a.scheduled_at > v_start - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_start
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  -- Fires send_appointment_sms's approved arm → the customer's confirmation,
  -- and makes the appointment billable for the first time.
  UPDATE appointments
     SET status = 'approved', updated_at = now()
   WHERE id = p_appointment_id;
END;
$function$;

COMMENT ON FUNCTION public.approve_appointment IS
  'Owner approves a pending request. Re-validates per-service capacity and staff '
  'availability under the per-org advisory lock — necessary because a pending '
  'request does NOT hold its slot, so the time may have been taken meanwhile. '
  'Raises not_found | not_authorized | not_pending | slot_taken. The approving '
  'UPDATE is what sends the confirmation SMS and what makes the appointment '
  'billable.';

REVOKE ALL ON FUNCTION public.approve_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_appointment(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 10. reject_elapsed_pending_appointments — the sweep.
--
--     A request nobody actions would otherwise sit pending forever: it would
--     never auto-complete (complete_elapsed_appointments only promotes
--     'approved'), never bill, and would clutter the top of the owner's list.
--     Once its slot time has passed it is moot, so reject it.
--
--     Runs with no auth.uid(), which is exactly what makes send_appointment_sms
--     skip the decline SMS for these — nobody should be texted about a request
--     that simply expired.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_elapsed_pending_appointments()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE appointments
     SET status = 'rejected', updated_at = now()
   WHERE status = 'pending'
     AND scheduled_at + make_interval(mins => duration_minutes) <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.reject_elapsed_pending_appointments IS
  'Cron sweep: rejects pending requests whose slot time has passed, freeing the '
  'owner''s queue. Silent by design — it runs without auth.uid(), which is the '
  'condition send_appointment_sms uses to skip the decline SMS.';

REVOKE ALL ON FUNCTION public.reject_elapsed_pending_appointments() FROM PUBLIC, anon, authenticated;

-- Idempotent (re)schedule, same pattern as 039/093. Matches the 5-minute
-- cadence of complete-elapsed-appointments, which handles the mirror case.
DO $$
BEGIN
  PERFORM cron.unschedule('reject-elapsed-pending');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'reject-elapsed-pending',
    '*/5 * * * *',
    $cron$ SELECT reject_elapsed_pending_appointments(); $cron$
  );
END $$;

-- ------------------------------------------------------------
-- 11. get_public_org — DROP + CREATE (the RETURNS TABLE signature changes).
--     Adds require_approval back as the last column so the booking page can
--     tell the customer their booking is a request, not a confirmation.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, cover_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, cancellation_window_hours integer, contact_email text, deposit_type text, deposit_value numeric, deposit_refundable boolean, require_approval boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT
    o.id, o.name::text, o.description, o.contact_phone, o.address, o.logo_url,
    o.cover_url,
    o.slug::text, o.booking_theme,
    COALESCE(
      (SELECT jsonb_object_agg(key, jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false)))
       FROM jsonb_each(o.payment_config)),
      '{}'::jsonb
    ) AS payment_methods,
    o.reviews_enabled,
    CASE WHEN o.reviews_enabled THEN (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.org_id = o.id) ELSE NULL END,
    CASE WHEN o.reviews_enabled THEN (SELECT count(*)::integer FROM reviews r WHERE r.org_id = o.id) ELSE 0 END,
    o.cancellation_window_hours,
    o.contact_email,
    o.deposit_type, o.deposit_value, o.deposit_refundable,
    o.require_approval
  FROM organisations o WHERE o.slug = p_slug;
$function$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;
