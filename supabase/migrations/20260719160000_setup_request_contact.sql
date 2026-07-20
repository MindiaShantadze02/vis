-- Concierge setup requests: capture explicit contact phone + email so the Vis
-- operator can reach the requester (previously only the login phone was snapshot
-- and no email was collected at all).

ALTER TABLE public.setup_requests
  ADD COLUMN IF NOT EXISTS contact_email text;

COMMENT ON COLUMN public.setup_requests.contact_email IS
  'Contact email supplied on the concierge setup-help form so the operator can reach the requester.';

-- Adding parameters changes the signature → drop the old 3-arg version first.
DROP FUNCTION IF EXISTS public.submit_setup_request(text, text, text);

CREATE OR REPLACE FUNCTION public.submit_setup_request(
  p_business_name text,
  p_address text,
  p_details text,
  p_contact_phone text DEFAULT NULL,
  p_contact_email text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_phone text;
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
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

  -- Explicit contact email is required (merchant reachability).
  IF v_email IS NULL
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR length(v_email) > 254 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  -- Contact phone: prefer the explicit field, else fall back to the login phone;
  -- normalized to the bare 9-digit national form the platform stores.
  v_phone := regexp_replace(
    coalesce(
      nullif(btrim(coalesce(p_contact_phone, '')), ''),
      (SELECT u.phone::text FROM auth.users u WHERE u.id = auth.uid())
    ),
    '\D', '', 'g');
  IF v_phone LIKE '995%' AND length(v_phone) = 12 THEN
    v_phone := substring(v_phone FROM 4);
  END IF;
  IF v_phone !~ '^[345][0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_phone');
  END IF;

  SELECT o.id INTO v_org FROM organisations o WHERE o.owner_id = auth.uid() LIMIT 1;

  BEGIN
    INSERT INTO setup_requests (user_id, org_id, phone, contact_email, business_name, address, details)
    VALUES (auth.uid(), v_org, v_phone, v_email,
            trim(p_business_name), nullif(trim(coalesce(p_address, '')), ''), trim(p_details))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_pending');
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- Only reachable behind AuthGuard; grant to authenticated (anon returns not_authorized).
GRANT EXECUTE ON FUNCTION public.submit_setup_request(text, text, text, text, text) TO authenticated, service_role;
