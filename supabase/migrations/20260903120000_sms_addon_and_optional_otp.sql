-- ============================================================
-- 20260903120000_sms_addon_and_optional_otp.sql
--
-- SMS becomes an opt-in, paid add-on; phone OTP stops being part of booking
-- validation.
--
-- Until now every guest booking was gated by an SMS one-time code, and every
-- org paid for that whether it wanted the messages or not. From here:
--
--   * organisations.sms_enabled (DEFAULT false) is the single switch. OFF —
--     the resting state — means a guest books by typing a phone number, no code
--     is sent, and the org receives no customer SMS at all. ON restores the OTP
--     step and the confirmation/reminder messages, and costs the business
--     ₾0.7 per appointment (priced in 20260903130000).
--
--   * appointments.source records who created the booking, and
--     appointments.sms_billable is stamped at insert time. An appointment an
--     admin types into the dashboard is 'admin': the customer already agreed
--     to it by phone, so it sends no SMS and is never billed the SMS fee.
--
-- Stamping sms_billable at INSERT (rather than reading organisations.sms_enabled
-- at close time) is what lets the toggle stay tenant-writable: flipping it off
-- changes what future bookings cost, never what past ones already cost. That is
-- also why sms_enabled is deliberately NOT listed in prevent_billing_self_update
-- alongside billing_status / billing_exempt / usage_anchor — see section 1.
-- ============================================================

-- ------------------------------------------------------------
-- 1. organisations.sms_enabled
--
--    Same shape as require_approval (20260822120000): a plain boolean with a
--    NOT NULL default and no CHECK.
--
--    NOT added to prevent_billing_self_update. That trigger is the column-level
--    ACL for organisations (organisations_update has no column list), so every
--    omission has to be deliberate: this one is. Choosing to buy the SMS add-on
--    is the tenant's decision, exactly like require_approval, and it cannot be
--    used to escape a bill because the charge is pinned per appointment below.
-- ------------------------------------------------------------
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organisations.sms_enabled IS
  'Opt-in SMS add-on, labelled "Enable SMS" in settings. FALSE by default: no '
  'booking OTP, no confirmation, no reminder. TRUE restores the OTP step and the '
  'customer messages and bills the org per appointment (billing_config -> '
  'sms_appointment_price). Owner-writable on purpose — it is a purchase, not a '
  'billing control — because sms_billable is pinned at insert time.';

-- ------------------------------------------------------------
-- 2. appointments.source + appointments.sms_billable
--
--    Defaults describe the untrusted case: an insert that never reaches the
--    stamping trigger is a public booking that owes no SMS fee.
-- ------------------------------------------------------------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS sms_billable boolean NOT NULL DEFAULT false;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_source_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_source_check CHECK (source IN ('public', 'admin'));

COMMENT ON COLUMN public.appointments.source IS
  '''public'' = booked through the public booking page (or the payment webhook '
  'on its behalf); ''admin'' = entered by an org member in the dashboard. Admin '
  'rows send no customer SMS and are never billed the SMS fee.';

COMMENT ON COLUMN public.appointments.sms_billable IS
  'Pinned at INSERT by stamp_appointment_origin: true only for a public booking '
  'at an org with sms_enabled on. Billing counts this column, never the org flag, '
  'so toggling the add-on cannot rewrite an already-closed period.';

CREATE INDEX IF NOT EXISTS idx_appointments_sms_billable
  ON public.appointments (org_id, scheduled_at) WHERE sms_billable;

-- ------------------------------------------------------------
-- 3. stamp_appointment_origin — the one place the two rules are decided.
--
--    Runs BEFORE INSERT ahead of every other guard (trg_000_ sorts before
--    trg_00_normalize_guest_appointment), so the rest of the stack — and the
--    AFTER-INSERT SMS trigger — can just read NEW.source.
--
--    The member test is the same one normalize_guest_appointment and
--    enforce_booking_verification already use. Note that the payment webhook
--    inserts as service_role with no auth.uid(), which is correct: a booking
--    paid for online is a public booking, not an admin one.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_appointment_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean;
BEGIN
  v_admin := auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
     WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()
  );

  IF v_admin THEN
    NEW.source       := 'admin';
    NEW.sms_billable := false;
  ELSE
    NEW.source       := 'public';
    NEW.sms_billable := coalesce(
      (SELECT o.sms_enabled FROM organisations o WHERE o.id = NEW.org_id), false);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.stamp_appointment_origin IS
  'BEFORE INSERT on appointments: pins source and sms_billable. Both columns are '
  'set here and nowhere else — a client cannot claim ''admin'' to dodge the fee, '
  'and it cannot claim sms_billable to bill someone else.';

REVOKE ALL ON FUNCTION public.stamp_appointment_origin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_000_stamp_appointment_origin ON public.appointments;
CREATE TRIGGER trg_000_stamp_appointment_origin
  BEFORE INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_appointment_origin();

-- ------------------------------------------------------------
-- 4. customer_sms_enabled — the single expression of "should this appointment
--    generate a customer SMS?", so the four send paths cannot drift apart.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_sms_enabled(p_org_id uuid, p_source text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(p_source, 'public') = 'public'
     AND coalesce((SELECT o.sms_enabled FROM organisations o WHERE o.id = p_org_id), false);
$$;

COMMENT ON FUNCTION public.customer_sms_enabled IS
  'True when a customer-facing SMS should go out for an appointment: the org '
  'bought the add-on AND the booking came through the public page. Admin-entered '
  'bookings are excluded because they are not billed for SMS.';

REVOKE ALL ON FUNCTION public.customer_sms_enabled(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. enforce_booking_verification — OTP only when the org bought SMS.
--
--    Rebuilt from 20260817150000 (the latest definition; no later migration
--    touches it) with one added early exit. This single change covers BOTH
--    untrusted paths: the on-site RPC below and the payment webhook, which is
--    gated today because this function has no service_role exemption.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_booking_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text;
  v_id    uuid;
BEGIN
  -- Admin of THIS org creating the appointment themselves: no OTP required.
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.org_id = NEW.org_id AND m.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  -- The org did not buy SMS, so there is no code to have sent and none to
  -- check. The phone is collected but unverified.
  IF NOT coalesce(
       (SELECT o.sms_enabled FROM organisations o WHERE o.id = NEW.org_id), false)
  THEN
    RETURN NEW;
  END IF;

  SELECT c.phone_number INTO v_phone FROM customers c WHERE c.id = NEW.customer_id;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'verification_required'; END IF;

  SELECT bv.id INTO v_id FROM booking_verifications bv
   WHERE bv.phone = v_phone
     AND bv.verified_at IS NOT NULL
     AND bv.consumed_at IS NULL
     AND bv.expires_at > now()
   ORDER BY bv.created_at DESC LIMIT 1;

  IF v_id IS NULL THEN RAISE EXCEPTION 'verification_required'; END IF;

  UPDATE booking_verifications SET consumed_at = now() WHERE id = v_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_booking_verification IS
  'BEFORE INSERT on appointments: requires a verified, unconsumed OTP for the '
  'customer''s phone — but only at orgs with sms_enabled. Org members are exempt '
  '(they are creating the booking themselves). Since 20260903120000 an org that '
  'has not bought the SMS add-on books without any code.';

-- ------------------------------------------------------------
-- 6. create_guest_booking — the on-site guest write moves server-side.
--
--    Why this has to exist. The customers table is GLOBAL: it has no org_id
--    (001_tables.sql), and its anon INSERT policy is gated only by
--    has_verified_booking_otp(phone_number) (081). There is no org in scope in
--    that policy, so a PER-ORG opt-out simply cannot be expressed in it. Rather
--    than weaken the policy for everyone, the guest write moves into a
--    SECURITY DEFINER function that knows which org it is booking at.
--
--    Two things this buys back, both of which removing the OTP would otherwise
--    have cost:
--
--    (a) The blocklist stops being an oracle. trg_zz_block_blocked_customer is
--        named to sort LAST specifically so that only a caller who has proved
--        they own the phone ever sees 'customer_blocked' (20260819120000). With
--        no OTP that guarantee is gone and anyone could probe (org, phone)
--        pairs. So when no code was required, the refusal is flattened to the
--        generic 'booking_failed'.
--
--    (b) Unverified bookings get a rate limit. Nothing else caps how many
--        bookings one phone number can make at one org.
--
--    The function does NOT bypass the guards: auth.uid() stays NULL for an anon
--    caller, so normalize_guest_appointment still pins status/payment_*, the
--    capacity trigger still runs under its advisory lock, and the billing gate
--    still applies. Only RLS on customers is bypassed, which is the point.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_guest_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text);

CREATE FUNCTION public.create_guest_booking(
  p_org_id          uuid,
  p_service_id      uuid,
  p_staff_id        uuid,
  p_scheduled_at    timestamptz,
  p_first_name      text,
  p_last_name       text,
  p_phone           text,
  p_notes           text,
  p_consent_version text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Per phone, per org, per day. Generous enough that a family booking several
  -- slots is unaffected, tight enough that an unverified number cannot flood a
  -- business's calendar.
  MAX_DAILY_UNVERIFIED constant int := 5;
  v_otp_required boolean;
  v_duration     int;
  v_customer_id  uuid := gen_random_uuid();
  v_appt_id      uuid := gen_random_uuid();
  v_recent       int;
BEGIN
  SELECT o.sms_enabled INTO v_otp_required
    FROM organisations o WHERE o.id = p_org_id;
  IF v_otp_required IS NULL THEN
    RAISE EXCEPTION 'org_not_found';
  END IF;

  -- Duration is resolved here rather than left to normalize_guest_appointment,
  -- so the column is right even when the caller is an authenticated user (for
  -- whom that trigger returns early).
  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  IF NOT v_otp_required THEN
    SELECT count(*) INTO v_recent
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
     WHERE a.org_id = p_org_id
       AND c.phone_number = p_phone
       AND a.created_at > now() - interval '24 hours';
    IF v_recent >= MAX_DAILY_UNVERIFIED THEN
      RAISE EXCEPTION 'too_many_bookings';
    END IF;
  END IF;

  -- One block for both rows: an exception here rolls the whole thing back, so a
  -- refused appointment never strands an orphan customer.
  BEGIN
    INSERT INTO customers (id, first_name, last_name, phone_number,
                           consent_accepted_at, consent_version)
    VALUES (v_customer_id, p_first_name, nullif(btrim(coalesce(p_last_name, '')), ''),
            p_phone, now(), p_consent_version);

    INSERT INTO appointments (id, org_id, service_id, customer_id, scheduled_at,
                              duration_minutes, staff_id, notes)
    VALUES (v_appt_id, p_org_id, p_service_id, v_customer_id, p_scheduled_at,
            v_duration, p_staff_id, nullif(btrim(coalesce(p_notes, '')), ''));
  EXCEPTION WHEN OTHERS THEN
    -- See (a) above: without a verified code, 'customer_blocked' would tell an
    -- anonymous prober something they have not earned.
    IF NOT v_otp_required AND SQLERRM LIKE '%customer_blocked%' THEN
      RAISE EXCEPTION 'booking_failed';
    END IF;
    RAISE;
  END;

  RETURN v_appt_id;
END;
$$;

COMMENT ON FUNCTION public.create_guest_booking IS
  'Anon entry point for an on-site (no-gateway) guest booking. Writes the '
  'customer and the appointment in one transaction, applies a per-phone daily cap '
  'when the org requires no OTP, and hides the blocklist refusal from unverified '
  'callers. All appointment triggers still run — this bypasses only RLS on the '
  'global customers table, which has no org to scope a per-org rule to.';

REVOKE ALL ON FUNCTION public.create_guest_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guest_booking(uuid, uuid, uuid, timestamptz, text, text, text, text, text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. customers_insert — anon loses its direct write.
--
--    With the booking write behind the RPC above (SECURITY DEFINER, so RLS does
--    not apply to it) and the payment webhook running as service_role, nothing
--    legitimate inserts a customer as anon any more. Closing it removes the last
--    anon write surface on a table that holds personal data.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS customers_insert ON public.customers;
CREATE POLICY customers_insert ON public.customers FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON POLICY customers_insert ON public.customers IS
  'Members only. Guest bookings go through create_guest_booking (SECURITY '
  'DEFINER) and the payment webhook (service_role); neither is subject to this '
  'policy. Before 20260903120000 anon could insert directly with a verified OTP.';

-- ------------------------------------------------------------
-- 8. get_public_org — append sms_enabled.
--
--    The booking page needs it to decide whether to ask for a code at all. It
--    exposes only whether a business sends SMS, which a customer discovers by
--    booking anyway. DROP + CREATE because the RETURNS TABLE signature changes.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
 RETURNS TABLE(id uuid, name text, description text, contact_phone text, address text, logo_url text, cover_url text, slug text, booking_theme text, payment_methods jsonb, reviews_enabled boolean, review_avg numeric, review_count integer, cancellation_window_hours integer, contact_email text, deposit_type text, deposit_value numeric, deposit_refundable boolean, require_approval boolean, sms_enabled boolean)
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
    o.require_approval,
    o.sms_enabled
  FROM organisations o WHERE o.slug = p_slug;
$function$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 9. The SMS send paths.
--
--    Three DB-driven paths carry customer messages. Each now consults
--    customer_sms_enabled(org, source).
--
-- 9a. send_appointment_sms (confirmation / approval / decline).
--
--     Patched by splicing the LIVE definition, not by re-transcribing it —
--     20260902120000 removed an auth.uid() guard from this same function by
--     splice, and a full CREATE OR REPLACE from any migration file in this repo
--     would silently put that guard back. Re-runnable: it exits if the gate is
--     already in place.
--
--     The function's own INSERT-arm member test becomes redundant once source
--     exists, but it is left alone: re-shaping the body is exactly the risk this
--     technique avoids.
-- ------------------------------------------------------------
DO $outer$
DECLARE
  v_def    text;
  v_oid    oid;
  v_anchor constant text := 'IF NOT v_send THEN';
  v_new    constant text :=
    E'IF v_send AND NOT customer_sms_enabled(NEW.org_id, NEW.source) THEN\n'
    '    v_send := false;\n'
    '  END IF;\n'
    '\n'
    '  IF NOT v_send THEN';
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'send_appointment_sms';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'send_appointment_sms not found';
  END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('customer_sms_enabled' in v_def) > 0 THEN
    RAISE NOTICE 'send_appointment_sms: already gated on the SMS add-on';
    RETURN;
  END IF;

  IF position(v_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'send_appointment_sms: expected guard "%" not found — inspect the live definition before retrying', v_anchor;
  END IF;

  EXECUTE replace(v_def, v_anchor, v_new);
  RAISE NOTICE 'send_appointment_sms: now gated on sms_enabled and source';
END
$outer$;

COMMENT ON FUNCTION public.send_appointment_sms IS
  'Fires the customer SMS on appointment insert/approval, and the decline notice '
  'on pending -> rejected. Since 20260903120000 every send is gated on '
  'customer_sms_enabled: the org must have bought the SMS add-on and the booking '
  'must have come through the public page, not an admin''s keyboard.';

-- ------------------------------------------------------------
-- 9b. dispatch_appointment_reminders (morning-of reminder).
--
--     Rebuilt from 20260813130000 — the latest definition — with the gate added
--     to the WHERE clause, NOT the loop body. The loop stamps reminder_sent_at
--     before it posts, so skipping inside the body would burn the one-shot flag
--     and the reminder could never be sent if the org later turned SMS on.
--     Keeping it in the WHERE also keeps sms_delivery_report's reminder_gap
--     check honest: a reminder that is never stamped cannot look like a gap.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_appointment_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  REMINDER_HOUR constant int := 8;
  v_url    text;
  v_secret text;
  v_today  date;
  r        record;
BEGIN
  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;
  IF v_url IS NULL THEN RETURN; END IF;

  IF extract(hour FROM (now() AT TIME ZONE 'Asia/Tbilisi')) < REMINDER_HOUR THEN
    RETURN;
  END IF;
  v_today := (now() AT TIME ZONE 'Asia/Tbilisi')::date;

  FOR r IN
    SELECT a.id
      FROM appointments a
      JOIN organisations o ON o.id = a.org_id
     WHERE a.status = 'approved'
       AND a.reminder_sent_at IS NULL
       AND a.scheduled_at > now()
       AND (a.scheduled_at AT TIME ZONE 'Asia/Tbilisi')::date = v_today
       AND (a.created_at   AT TIME ZONE 'Asia/Tbilisi')::date < v_today
       AND o.billing_status <> 'suspended'
       -- The SMS add-on, and public bookings only.
       AND o.sms_enabled
       AND a.source = 'public'
  LOOP
    UPDATE appointments SET reminder_sent_at = now() WHERE id = r.id;
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object('appointment_id', r.id, 'message_type', 'appointment_reminder'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'dispatch_appointment_reminders failed for appointment %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_appointment_reminders() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.dispatch_appointment_reminders IS
  'Cron (*/15): morning-of reminder for today''s approved appointments, from '
  '08:00 Asia/Tbilisi. Since 20260903120000 only for orgs with the SMS add-on, '
  'and only for public bookings — the gate is in the WHERE so reminder_sent_at is '
  'never burned on a message that was not sent.';

-- ------------------------------------------------------------
-- 9c. request_meeting_link_sms (owner presses "send link").
--
--     Rebuilt from 082 (never redefined) with one added check. This is the only
--     send path that RAISES rather than no-ops, because the owner is standing
--     there waiting: OverviewPage surfaces the message in a toast, so an org
--     without the add-on is told why nothing happened.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_meeting_link_sms(p_appointment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_link   text;
  v_url    text;
  v_secret text;
BEGIN
  SELECT org_id, meeting_link
    INTO v_org_id, v_link
    FROM appointments WHERE id = p_appointment_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'appointment not found' USING errcode = 'no_data_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_members m WHERE m.org_id = v_org_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized' USING errcode = 'insufficient_privilege';
  END IF;

  IF v_link IS NULL OR btrim(v_link) = '' THEN
    RAISE EXCEPTION 'no meeting link set' USING errcode = 'check_violation';
  END IF;

  -- The add-on alone, NOT customer_sms_enabled: the source rule exists to stop
  -- AUTOMATIC messages (and their fee) on bookings the owner typed in. This send
  -- is an explicit owner action on an appointment in front of them, so refusing
  -- it because they also created that appointment would make phone-taken online
  -- bookings unusable.
  IF NOT coalesce(
       (SELECT o.sms_enabled FROM organisations o WHERE o.id = v_org_id), false)
  THEN
    RAISE EXCEPTION 'sms_disabled' USING errcode = 'check_violation';
  END IF;

  SELECT sms_config ->> 'send_sms_url', sms_config ->> 'webhook_secret'
    INTO v_url, v_secret
    FROM platform_config
   WHERE id = 1;
  IF v_url IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('appointment_id', p_appointment_id, 'message_type', 'meeting_link'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_meeting_link_sms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_meeting_link_sms(uuid) TO authenticated;

COMMENT ON FUNCTION public.request_meeting_link_sms IS
  'Owner-invoked: texts the appointment''s meeting link to the customer. Requires '
  'the SMS add-on (raises sms_disabled otherwise) but NOT a public booking — '
  'unlike the automatic confirmation/reminder, this send is an explicit owner '
  'action, so it is allowed on admin-entered appointments too.';

-- ------------------------------------------------------------
-- 10. create_admin_appointment — owner-side booking entry returns.
--
--     Manual appointment creation was removed on 2026-08-13 along with
--     recurring series. It comes back here because the SMS add-on needs it:
--     a business that phones its customers itself should be able to write the
--     booking down without paying for a message the customer already had.
--
--     SECURITY DEFINER only so the customer row can be written alongside the
--     appointment in one transaction. auth.uid() is preserved inside a definer
--     function, so stamp_appointment_origin still sees a member and stamps
--     source='admin' / sms_billable=false — the no-SMS and no-fee rules follow
--     from that automatically rather than being restated here.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_admin_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text);

CREATE FUNCTION public.create_admin_appointment(
  p_org_id       uuid,
  p_service_id   uuid,
  p_staff_id     uuid,
  p_scheduled_at timestamptz,
  p_first_name   text,
  p_last_name    text,
  p_phone        text,
  p_notes        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration    int;
  v_customer_id uuid := gen_random_uuid();
  v_appt_id     uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM org_members m WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT s.duration_minutes INTO v_duration
    FROM services s
   WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active;
  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  INSERT INTO customers (id, first_name, last_name, phone_number)
  VALUES (v_customer_id, p_first_name, nullif(btrim(coalesce(p_last_name, '')), ''), p_phone);

  -- status/payment_* are set explicitly: normalize_guest_appointment returns
  -- early for members, so nothing downstream fills them in.
  INSERT INTO appointments (id, org_id, service_id, customer_id, scheduled_at,
                            duration_minutes, staff_id, notes,
                            status, payment_method, payment_status)
  VALUES (v_appt_id, p_org_id, p_service_id, v_customer_id, p_scheduled_at,
          v_duration, p_staff_id, nullif(btrim(coalesce(p_notes, '')), ''),
          'approved', 'in_person', 'unpaid');

  RETURN v_appt_id;
END;
$$;

COMMENT ON FUNCTION public.create_admin_appointment IS
  'Owner/admin books on a customer''s behalf from the dashboard calendar. Lands '
  'approved and unpaid (settled in person). Sends no customer SMS and carries no '
  'SMS fee — both follow from stamp_appointment_origin seeing an org member.';

REVOKE ALL ON FUNCTION public.create_admin_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admin_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text) TO authenticated;
