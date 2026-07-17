-- ============================================================
-- 093_waitlist.sql
-- Run AFTER 092_self_service_manage.sql.
--
-- Phase 4 — cancellation waitlist. A customer joins a waitlist for a service on
-- a desired date; when a matching slot frees (slot_freed_events, 092), a cron
-- offers it to the oldest active entry with a time-limited claim link (OTP-
-- gated). Expired offers roll to the next candidate. Turns cancellations into
-- filled slots.
--
-- Objects:
--   * waitlist_entries / waitlist_offers  (+ RLS: members read own org)
--   * join_waitlist(...)          — anon, consent-only (the OTP is at claim time)
--   * get_waitlist_offer(token)   — anon read for the /waitlist/:token page
--   * claim_waitlist_offer(token) — service-role writer (the claim-waitlist edge
--                                   fn calls it after verifying the OTP); books
--                                   under the per-org lock, 409 on race
--   * dispatch_waitlist_offers(org?) — cron: expire stale offers + roll over,
--                                   then offer each unclaimed freed slot to the
--                                   next candidate and POST the notify SMS
--   * sms_log.message_type + waitlist_offer / waitlist_claimed
--
-- Deposit note: a waitlist claim books directly (in_person, unpaid) — a deposit,
-- if any, is collected in person. Waitlist offers go to known customers the
-- business is trying to fit in, so the pay-online-first rule is relaxed here.
-- ============================================================

-- --------------------------------------------------------
-- 1. Tables.
-- --------------------------------------------------------
CREATE TABLE waitlist_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  service_id          uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  -- null = "any professional"; else the customer wants this specific member.
  staff_id            uuid REFERENCES org_members(id) ON DELETE SET NULL,
  -- The day the customer wants (business date). "any time that day" semantics.
  desired_date        date NOT NULL,
  first_name          text NOT NULL,
  last_name           text,
  phone               text NOT NULL,
  consent_accepted_at timestamptz,
  consent_version     text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'offered', 'converted', 'expired', 'cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- One live entry per phone+service+day — a re-join is a no-op (anti-spam).
CREATE UNIQUE INDEX uniq_active_waitlist_entry
  ON waitlist_entries (phone, service_id, desired_date)
  WHERE status IN ('active', 'offered');
CREATE INDEX idx_waitlist_entries_match
  ON waitlist_entries (org_id, service_id, desired_date, status);

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waitlist_entries_select" ON waitlist_entries
  FOR SELECT TO public USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

CREATE TABLE waitlist_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id            uuid NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  slot_freed_event_id uuid NOT NULL REFERENCES slot_freed_events(id) ON DELETE CASCADE,
  org_id              uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- FKs so PostgREST can embed service/staff on the offer (the edge fn reads them).
  service_id          uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id            uuid REFERENCES org_members(id) ON DELETE SET NULL,
  scheduled_at        timestamptz NOT NULL,
  duration_minutes    int NOT NULL,
  -- The capability in the claim link (/waitlist/:token).
  claim_token         uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired')),
  notified_at         timestamptz,
  offered_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_waitlist_offers_pending ON waitlist_offers (slot_freed_event_id) WHERE status = 'pending';

ALTER TABLE waitlist_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waitlist_offers_select" ON waitlist_offers
  FOR SELECT TO public USING (org_id = ANY (get_user_org_ids()) OR is_superadmin());

-- --------------------------------------------------------
-- 2. join_waitlist — consent-only (no OTP; the commitment/OTP is at claim time).
--    Dedups via the unique index (re-join returns the existing active entry).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION join_waitlist(
  p_org_id          uuid,
  p_service_id      uuid,
  p_desired_date    date,
  p_first_name      text,
  p_phone           text,
  p_last_name       text DEFAULT NULL,
  p_staff_id        uuid DEFAULT NULL,
  p_consent_version text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text;
  v_id    uuid;
BEGIN
  -- Bare 9-digit Georgian phone, matching how customers/booking store it.
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF left(v_phone, 3) = '995' THEN v_phone := substr(v_phone, 4); END IF;
  IF v_phone !~ '^[345]\d{8}$' THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF length(trim(coalesce(p_first_name, ''))) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_desired_date < (now() AT TIME ZONE 'Asia/Tbilisi')::date THEN RAISE EXCEPTION 'invalid_date'; END IF;

  -- Service must belong to the org and be active.
  IF NOT EXISTS (SELECT 1 FROM services s WHERE s.id = p_service_id AND s.org_id = p_org_id AND s.is_active) THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  INSERT INTO waitlist_entries (org_id, service_id, staff_id, desired_date, first_name, last_name, phone,
                                consent_accepted_at, consent_version)
  VALUES (p_org_id, p_service_id, p_staff_id, p_desired_date, trim(p_first_name),
          nullif(trim(coalesce(p_last_name, '')), ''), v_phone,
          CASE WHEN p_consent_version IS NOT NULL THEN now() END, p_consent_version)
  ON CONFLICT (phone, service_id, desired_date) WHERE status IN ('active', 'offered')
  DO NOTHING
  RETURNING id INTO v_id;

  -- On conflict the row already exists — return it so the UI is idempotent.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM waitlist_entries
     WHERE phone = v_phone AND service_id = p_service_id AND desired_date = p_desired_date
       AND status IN ('active', 'offered')
     LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION join_waitlist IS
  'Anon consent-only waitlist join (OTP is deferred to claim). Dedups per '
  'phone+service+day. Returns the (new or existing) entry id.';
REVOKE ALL ON FUNCTION join_waitlist(uuid, uuid, date, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_waitlist(uuid, uuid, date, text, text, text, uuid, text) TO anon, authenticated;

-- --------------------------------------------------------
-- 3. get_waitlist_offer — the /waitlist/:token page read (stripped jsonb).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION get_waitlist_offer(p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'org_name',       o.name,
    'slug',           o.slug,
    'booking_theme',  o.booking_theme,
    'service_name',   s.name,
    'scheduled_at',   wo.scheduled_at,
    'duration_minutes', wo.duration_minutes,
    'staff_name',     m.display_name,
    'status',         wo.status,
    'expires_at',     wo.expires_at,
    'phone_masked',   '••••' || right(we.phone, 2),
    'can_claim',      (wo.status = 'pending' AND wo.expires_at > now())
  )
  FROM waitlist_offers wo
  JOIN waitlist_entries we ON we.id = wo.entry_id
  JOIN organisations o     ON o.id = wo.org_id
  JOIN services s          ON s.id = wo.service_id
  LEFT JOIN org_members m  ON m.id = wo.staff_id
  WHERE wo.claim_token = p_token;
$$;

COMMENT ON FUNCTION get_waitlist_offer IS
  'Public read for /waitlist/:token — stripped offer/slot context + can_claim.';
REVOKE ALL ON FUNCTION get_waitlist_offer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_waitlist_offer(uuid) TO anon, authenticated;

-- --------------------------------------------------------
-- 4. claim_waitlist_offer — book the offered slot. Service-role only (the
--    claim-waitlist edge fn calls it AFTER verifying the OTP; the appointment
--    insert consumes that verified challenge via enforce_booking_verification).
--    The INSERT capacity trigger exempts service-role, so we re-check capacity
--    here under the same per-org advisory lock. Raises offer_invalid /
--    offer_expired / slot_taken.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_waitlist_offer(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer     waitlist_offers%ROWTYPE;
  v_entry     waitlist_entries%ROWTYPE;
  v_cap       int;
  v_end       timestamptz;
  v_overlaps  int;
  v_customer  uuid;
  v_appt      uuid;
BEGIN
  SELECT * INTO v_offer FROM waitlist_offers WHERE claim_token = p_token;
  IF v_offer.id IS NULL OR v_offer.status <> 'pending' THEN RAISE EXCEPTION 'offer_invalid'; END IF;
  IF v_offer.expires_at <= now() THEN RAISE EXCEPTION 'offer_expired'; END IF;

  SELECT * INTO v_entry FROM waitlist_entries WHERE id = v_offer.entry_id;
  v_end := v_offer.scheduled_at + make_interval(mins => v_offer.duration_minutes);

  PERFORM pg_advisory_xact_lock(hashtext(v_offer.org_id::text));

  -- Per-service capacity at the offered slot (the freed unit may already be
  -- gone if someone booked normally in the meantime).
  SELECT s.max_per_slot INTO v_cap FROM services s WHERE s.id = v_offer.service_id;
  SELECT count(*) INTO v_overlaps
    FROM appointments a
   WHERE a.org_id = v_offer.org_id AND a.service_id = v_offer.service_id
     AND a.status NOT IN ('rejected', 'cancelled')
     AND a.scheduled_at > v_offer.scheduled_at - interval '1 day'
     AND a.scheduled_at < v_end
     AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_offer.scheduled_at;
  IF v_overlaps >= coalesce(v_cap, 1) THEN RAISE EXCEPTION 'slot_taken'; END IF;

  IF v_offer.staff_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.org_id = v_offer.org_id AND a.staff_id = v_offer.staff_id
       AND a.status NOT IN ('rejected', 'cancelled')
       AND a.scheduled_at > v_offer.scheduled_at - interval '1 day'
       AND a.scheduled_at < v_end
       AND a.scheduled_at + make_interval(mins => a.duration_minutes) > v_offer.scheduled_at
  ) THEN RAISE EXCEPTION 'slot_taken'; END IF;

  INSERT INTO customers (first_name, last_name, phone_number, consent_accepted_at, consent_version)
  VALUES (v_entry.first_name, v_entry.last_name, v_entry.phone, v_entry.consent_accepted_at, v_entry.consent_version)
  RETURNING id INTO v_customer;

  -- Guest-shaped insert: the OTP trigger consumes the verified challenge; the
  -- normalize trigger (service-role) keeps these fields.
  INSERT INTO appointments (org_id, service_id, customer_id, scheduled_at, duration_minutes, staff_id,
                            status, payment_method, payment_status)
  VALUES (v_offer.org_id, v_offer.service_id, v_customer, v_offer.scheduled_at, v_offer.duration_minutes,
          v_offer.staff_id, 'approved', 'in_person', 'unpaid')
  RETURNING id INTO v_appt;

  UPDATE waitlist_offers  SET status = 'claimed' WHERE id = v_offer.id;
  UPDATE waitlist_entries SET status = 'converted' WHERE id = v_entry.id;
  UPDATE slot_freed_events SET processed_at = now() WHERE id = v_offer.slot_freed_event_id;

  RETURN v_appt;
END;
$$;

COMMENT ON FUNCTION claim_waitlist_offer IS
  'Books an offered waitlist slot (in_person/unpaid) under the per-org advisory '
  'lock; the appointment insert consumes the verified OTP. Service-role only.';
REVOKE ALL ON FUNCTION claim_waitlist_offer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_waitlist_offer(uuid) TO service_role;

-- --------------------------------------------------------
-- 5. dispatch_waitlist_offers — cron. Expire stale offers (roll the entry back
--    to active for a future slot), then offer each unclaimed freed slot to the
--    next candidate not yet offered it, POSTing the notify SMS via the
--    claim-waitlist edge fn. p_org_id scopes it (owner "run now" / e2e); NULL =
--    all orgs (cron). Internal/superadmin/member-of-org authorized.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION dispatch_waitlist_offers(p_org_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  OFFER_WINDOW constant interval := interval '15 minutes';
  v_notify_url text;
  v_secret     text;
  v_made       int := 0;
  r            record;
  v_entry_id   uuid;
  v_offer_id   uuid;
BEGIN
  IF NOT (auth.uid() IS NULL OR is_superadmin()
          OR (p_org_id IS NOT NULL AND p_org_id = ANY (get_user_org_ids()))) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT replace(sms_config ->> 'send_sms_url', 'send-sms', 'claim-waitlist'),
         sms_config ->> 'webhook_secret'
    INTO v_notify_url, v_secret
    FROM platform_config WHERE id = 1;

  -- Expire stale pending offers; a rolled-back entry can be offered again.
  FOR r IN SELECT id, entry_id FROM waitlist_offers
            WHERE status = 'pending' AND expires_at < now()
              AND (p_org_id IS NULL OR org_id = p_org_id) LOOP
    UPDATE waitlist_offers SET status = 'expired' WHERE id = r.id;
    UPDATE waitlist_entries SET status = 'active' WHERE id = r.entry_id AND status = 'offered';
  END LOOP;

  -- Offer each unclaimed future freed slot to the next un-offered candidate.
  FOR r IN
    SELECT sfe.* FROM slot_freed_events sfe
     WHERE sfe.processed_at IS NULL AND sfe.freed_at > now()
       AND (p_org_id IS NULL OR sfe.org_id = p_org_id)
       AND NOT EXISTS (SELECT 1 FROM waitlist_offers wo
                        WHERE wo.slot_freed_event_id = sfe.id AND wo.status = 'pending')
     ORDER BY sfe.created_at
  LOOP
    SELECT we.id INTO v_entry_id
      FROM waitlist_entries we
     WHERE we.status = 'active' AND we.org_id = r.org_id AND we.service_id = r.service_id
       AND (we.staff_id IS NULL OR we.staff_id = r.staff_id)
       AND we.desired_date = (r.freed_at AT TIME ZONE 'Asia/Tbilisi')::date
       AND NOT EXISTS (SELECT 1 FROM waitlist_offers wo
                        WHERE wo.slot_freed_event_id = r.id AND wo.entry_id = we.id)
     ORDER BY we.created_at
     LIMIT 1;

    IF v_entry_id IS NULL THEN
      -- No (more) candidates for this slot.
      UPDATE slot_freed_events SET processed_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;

    INSERT INTO waitlist_offers (entry_id, slot_freed_event_id, org_id, service_id, staff_id,
                                 scheduled_at, duration_minutes, expires_at)
    VALUES (v_entry_id, r.id, r.org_id, r.service_id, r.staff_id, r.freed_at, r.duration_minutes,
            now() + OFFER_WINDOW)
    RETURNING id INTO v_offer_id;
    UPDATE waitlist_entries SET status = 'offered' WHERE id = v_entry_id;
    v_made := v_made + 1;

    -- Best-effort notify SMS (claim-waitlist edge fn builds the body + link).
    IF v_notify_url IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := v_notify_url,
          body    := jsonb_build_object('action', 'notify', 'offer_id', v_offer_id),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-sms-secret', coalesce(v_secret, ''))
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'dispatch_waitlist_offers notify failed for %: %', v_offer_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_made;
END;
$$;

COMMENT ON FUNCTION dispatch_waitlist_offers IS
  'Cron: expires stale waitlist offers + rolls them over, then offers each '
  'unclaimed freed slot to the next candidate and POSTs the notify SMS. '
  'p_org_id scopes it (owner run-now); NULL = all orgs.';
REVOKE ALL ON FUNCTION dispatch_waitlist_offers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dispatch_waitlist_offers(uuid) TO authenticated, service_role;

-- --------------------------------------------------------
-- 6. New SMS types.
-- --------------------------------------------------------
ALTER TABLE sms_log DROP CONSTRAINT sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation', 'approval_update', 'admin_new_booking', 'admin_reminder',
    'invitation', 'verification_code', 'appointment_reminder', 'setup_complete',
    'meeting_link', 'refund_update', 'reschedule_update', 'cancellation_update',
    'waitlist_offer', 'waitlist_claimed'
  ));

-- --------------------------------------------------------
-- 7. Cron — every 5 minutes (offers live 15 min, so this catches expiries and
--    new freed slots promptly). Same idempotent (re)schedule pattern as 039.
-- --------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-waitlist-offers') THEN
    PERFORM cron.unschedule('dispatch-waitlist-offers');
  END IF;
  PERFORM cron.schedule('dispatch-waitlist-offers', '*/5 * * * *', $cron$ SELECT dispatch_waitlist_offers(); $cron$);
END;
$$;
