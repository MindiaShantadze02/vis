-- ============================================================
-- 079_setup_request_phone_normalize.sql
-- setup_requests.phone was snapshotted verbatim from auth.users.phone, which
-- is stored E.164-ish without the plus ("995XXXXXXXXX"). Everywhere else the
-- platform stores the bare 9-digit national number (customers.phone_number,
-- organisations.contact_phone — see 010's format checks), and the superadmin
-- "create business" flow copies the request phone into contact_phone, which
-- tripped organisations_contact_phone_format.
--
-- Normalise at the source: submit_setup_request strips separators and a
-- leading 995, and existing rows are rewritten to match.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_setup_request(
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
  -- Bare 9-digit national form, matching the rest of the platform.
  v_phone := regexp_replace(v_phone, '\D', '', 'g');
  IF v_phone LIKE '995%' AND length(v_phone) = 12 THEN
    v_phone := substring(v_phone FROM 4);
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

-- Rows submitted before this fix.
UPDATE setup_requests
   SET phone = substring(regexp_replace(phone, '\D', '', 'g') FROM 4)
 WHERE regexp_replace(phone, '\D', '', 'g') LIKE '995%'
   AND length(regexp_replace(phone, '\D', '', 'g')) = 12;
