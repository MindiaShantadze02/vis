-- ============================================================
-- 078_concierge_setup.sql
-- Concierge onboarding ("we set it up for you") + two small superadmin gaps.
--
--   1. get_public_org() gains `address` so the booking page can show where
--      the business is (077 added the column + anon grant; the page reads
--      through this RPC, not the table).
--   2. list_orgs_overview() gains contact_phone + owner_phone so the
--      superadmin org list can be searched by phone (login is phone-based,
--      so owner_email is usually empty).
--   3. Superadmin write access to the org-setup tables (services,
--      service_staff, org_members update, working hours) so a superadmin can
--      configure a business on the owner's behalf. Deliberately additive
--      permissive policies — existing member policies are untouched. Tier
--      guards (staff seats, billing columns) still apply to superadmins
--      except where they already carve themselves out.
--   4. setup_requests: the "help me set it up" queue. Businesses submit one
--      open request (via RPC, phone snapshotted server-side); superadmins
--      work it and mark it completed, which texts the requester
--      (setup_complete SMS via the same pg_net → send-sms pipeline as
--      booking notifications).
-- ============================================================

-- ------------------------------------------------------------
-- 1. get_public_org + address (return type changes → drop first).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_org(text);

CREATE FUNCTION public.get_public_org(p_slug text)
RETURNS TABLE (
  id              uuid,
  name            text,
  description     text,
  contact_phone   text,
  address         text,
  logo_url        text,
  slug            text,
  booking_theme   text,
  payment_methods jsonb,
  reviews_enabled boolean,
  review_avg      numeric,
  review_count    integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    o.name::text,
    o.description,
    o.contact_phone,
    o.address,
    o.logo_url,
    o.slug::text,
    o.booking_theme,
    COALESCE(
      (
        SELECT jsonb_object_agg(
                 key,
                 jsonb_build_object('enabled', COALESCE((value ->> 'enabled')::boolean, false))
               )
        FROM jsonb_each(o.payment_config)
      ),
      '{}'::jsonb
    ) AS payment_methods,
    o.reviews_enabled,
    CASE WHEN o.reviews_enabled
      THEN (SELECT round(avg(r.rating)::numeric, 1) FROM reviews r WHERE r.org_id = o.id)
      ELSE NULL END AS review_avg,
    CASE WHEN o.reviews_enabled
      THEN (SELECT count(*)::integer FROM reviews r WHERE r.org_id = o.id)
      ELSE 0 END AS review_count
  FROM organisations o
  WHERE o.slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.get_public_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_org(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. list_orgs_overview + phones (return type changes → drop first).
--    Self-gates on is_superadmin(), same as 026.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_orgs_overview();

CREATE FUNCTION public.list_orgs_overview()
RETURNS TABLE (
  id                uuid,
  name              text,
  slug              text,
  subscription_tier text,
  created_at        timestamptz,
  owner_email       text,
  owner_phone       text,
  contact_phone     text,
  member_count      int,
  usage             int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
    SELECT
      o.id,
      o.name::text,
      o.slug::text,
      o.subscription_tier,
      o.created_at,
      u.email::text,
      u.phone::text,
      o.contact_phone,
      (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id),
      org_usage(o.id)
    FROM organisations o
    LEFT JOIN auth.users u ON u.id = o.owner_id
    ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_orgs_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_orgs_overview() TO authenticated;

-- ------------------------------------------------------------
-- 3. Superadmin write access for on-behalf setup.
--    (SELECTs are already public or superadmin-inclusive; organisations
--    UPDATE and org_members INSERT/DELETE already allow superadmins.)
-- ------------------------------------------------------------
CREATE POLICY "services_superadmin_insert"
  ON services FOR INSERT
  WITH CHECK (is_superadmin());

CREATE POLICY "services_superadmin_update"
  ON services FOR UPDATE
  USING (is_superadmin());

CREATE POLICY "service_staff_superadmin_write"
  ON service_staff FOR ALL
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

CREATE POLICY "org_members_superadmin_update"
  ON org_members FOR UPDATE
  USING (is_superadmin());

CREATE POLICY "wh_template_superadmin_write"
  ON working_hours_template FOR ALL
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

CREATE POLICY "wh_overrides_superadmin_write"
  ON working_hours_overrides FOR ALL
  USING (is_superadmin())
  WITH CHECK (is_superadmin());

-- ------------------------------------------------------------
-- 4. setup_requests — the concierge queue.
-- ------------------------------------------------------------
CREATE TABLE setup_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Set when the requester already has an org, or once a superadmin creates
  -- one for them. NULL = "business not created yet".
  org_id        uuid REFERENCES organisations(id) ON DELETE SET NULL,
  -- SMS target, snapshotted from auth.users at submit time (server-side, so
  -- a caller can't point the completion SMS at someone else's phone).
  phone         text NOT NULL,
  business_name text NOT NULL,
  address       text,
  -- Free-form description: services (price/duration), specialists, working
  -- hours — everything the superadmin needs to configure the account.
  details       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  completed_at  timestamptz,
  completed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE setup_requests IS
  'Concierge onboarding queue: a business describes what it needs, a '
  'superadmin configures the account on their behalf, marking it completed '
  'texts the requester (setup_complete SMS).';

-- One open request per user — resubmitting while pending is rejected.
CREATE UNIQUE INDEX setup_requests_one_pending
  ON setup_requests (user_id) WHERE status = 'pending';

ALTER TABLE setup_requests ENABLE ROW LEVEL SECURITY;

-- Requester sees their own; superadmins see the queue.
CREATE POLICY "setup_requests_select"
  ON setup_requests FOR SELECT
  USING (user_id = auth.uid() OR is_superadmin());

-- No INSERT policy: rows are created only through submit_setup_request()
-- (SECURITY DEFINER), which snapshots the phone server-side.

-- Superadmins link the created org (org_id); status flips via
-- complete_setup_request() below.
CREATE POLICY "setup_requests_superadmin_update"
  ON setup_requests FOR UPDATE
  USING (is_superadmin());

-- The requester may withdraw an open request; superadmins can clear spam.
CREATE POLICY "setup_requests_delete"
  ON setup_requests FOR DELETE
  USING ((user_id = auth.uid() AND status = 'pending') OR is_superadmin());

-- Submit: derives phone + existing org from the caller's account.
CREATE FUNCTION public.submit_setup_request(
  p_business_name text,
  p_address       text,
  p_details       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone text;
  v_org   uuid;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF length(trim(coalesce(p_business_name, ''))) < 2
     OR length(trim(coalesce(p_details, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF length(p_business_name) > 255 OR length(coalesce(p_address, '')) > 255
     OR length(p_details) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_long');
  END IF;

  SELECT u.phone::text INTO v_phone FROM auth.users u WHERE u.id = auth.uid();
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_phone');
  END IF;

  SELECT o.id INTO v_org FROM organisations o WHERE o.owner_id = auth.uid() LIMIT 1;

  BEGIN
    INSERT INTO setup_requests (user_id, org_id, phone, business_name, address, details)
    VALUES (auth.uid(), v_org, v_phone,
            trim(p_business_name), nullif(trim(coalesce(p_address, '')), ''), trim(p_details))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_pending');
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_setup_request(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_setup_request(text, text, text) TO authenticated;

-- Complete: superadmin-only; the AFTER UPDATE trigger below sends the SMS.
CREATE FUNCTION public.complete_setup_request(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE setup_requests
     SET status = 'completed', completed_at = now(), completed_by = auth.uid()
   WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_setup_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_setup_request(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 5. setup_complete SMS: allow the type in the audit log, notify on
--    completion via the same pg_net → send-sms pipeline as bookings (031).
-- ------------------------------------------------------------
ALTER TABLE sms_log DROP CONSTRAINT IF EXISTS sms_log_message_type_check;
ALTER TABLE sms_log ADD CONSTRAINT sms_log_message_type_check
  CHECK (message_type IN (
    'booking_confirmation','approval_update',
    'admin_new_booking','admin_reminder','invitation',
    'verification_code','appointment_reminder','setup_complete'
  ));

CREATE FUNCTION notify_setup_request_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
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
      body    := jsonb_build_object(
                   'setup_request_id', NEW.id,
                   'message_type', 'setup_complete'
                 ),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-sms-secret', coalesce(v_secret, '')
                 )
    );
  EXCEPTION WHEN OTHERS THEN
    -- SMS is a side effect; never fail the completion itself.
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_setup_request_completed
  AFTER UPDATE ON setup_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_setup_request_completed();
