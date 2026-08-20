-- ============================================================
-- 20260830120000_superadmins_by_phone.sql
--
-- Superadmins are added and listed by PHONE, not email.
--
-- Sign-in has been phone+password since the auth rework, so auth.users.email is
-- frequently NULL — the platform's only existing superadmin has no email at all.
-- "Add by email" therefore asked for the one identifier the platform does not
-- use, and matched nothing for a typical account. The phone IS the account.
--
-- Both functions are DROPped rather than replaced (argument list / return type
-- change), which takes their grants with them — EXECUTE is re-applied to
-- `authenticated` below; forgetting that 403s the whole page. Dropping the old
-- add_superadmin(text) email signature outright is deliberate: keeping it as an
-- overload would leave a second, broken way in.
-- ============================================================
DROP FUNCTION IF EXISTS public.add_superadmin(text);
DROP FUNCTION IF EXISTS public.list_superadmins();

-- Accepts anything the rest of the app accepts: "599123456", "995599123456",
-- "+995 599 12 34 56". normalize_ge_phone reduces it to the bare 9-digit
-- national number; auth.users stores it prefixed with 995 and no plus.
--
-- invalid_phone and user_not_found are returned as values rather than raised so
-- the UI can tell the two apart — "that isn't a number" and "nobody has that
-- number" need different fixes from the person typing.
CREATE FUNCTION public.add_superadmin(p_phone text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_local text;
  v_uid   uuid;
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  v_local := normalize_ge_phone(p_phone);
  IF v_local IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_phone');
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE phone = '995' || v_local LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  INSERT INTO superadmins (user_id, added_by)
  VALUES (v_uid, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid);
END;
$function$;

-- Returns the bare 9-digit national number; the client formats it with
-- displayGeorgianPhone(). email stays in the payload because some accounts do
-- have one and it helps identify a person, but it is no longer the key.
CREATE FUNCTION public.list_superadmins()
  RETURNS TABLE (user_id uuid, phone text, email text, created_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
    SELECT s.user_id,
           regexp_replace(coalesce(u.phone, ''), '^995', '')::text,
           u.email::text,
           s.created_at
      FROM superadmins s
      JOIN auth.users u ON u.id = s.user_id
     ORDER BY s.created_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_superadmin(text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_superadmins()    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_superadmin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_superadmins()   TO authenticated;

COMMENT ON FUNCTION public.add_superadmin IS
  'Grants superadmin to an EXISTING account, found by Georgian phone number '
  '(the app''s sign-in identifier). Returns {ok:false,error:invalid_phone|'
  'user_not_found} rather than raising, so the UI can explain which it was.';
