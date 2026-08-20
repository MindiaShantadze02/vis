-- ============================================================
-- 20260831120000_data_access_log.sql
-- Applied to cloud as: data_access_log, log_superadmin_rpc_access,
--                      log_platform_health_rpc_access (2026-08-20)
--
-- Article 27 requires processing actions to be logged. Nothing recorded who
-- looked at what: superadmin RLS grants read across every tenant's customers,
-- appointments and sms_log, and there was no audit table in the database at all
-- (docs/COMPLIANCE_GE_DPL.md, finding G4).
--
-- ⚠️ SCOPE — stated so nobody mistakes this for complete coverage. This logs the
-- superadmin RPCs. A superadmin JWT can still GET /rest/v1/customers directly
-- through PostgREST, and that read is NOT captured here; the only record of it
-- is Supabase's platform request log, whose retention is short. That is an
-- accepted residual risk, recorded in docs/PROCESSING_RECORD.md. Closing it
-- properly means dropping is_superadmin() from those RLS policies and routing
-- support access through logged RPCs — decided against for now because it
-- removes ad-hoc debugging.
-- ============================================================
CREATE TABLE IF NOT EXISTS data_access_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid,
  action         text NOT NULL,
  org_id         uuid REFERENCES organisations(id) ON DELETE SET NULL,
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_access_log_created ON data_access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_access_log_actor   ON data_access_log (actor_user_id, created_at DESC);

ALTER TABLE data_access_log ENABLE ROW LEVEL SECURITY;

-- Read-only to superadmins, APPEND-ONLY to everyone: there is deliberately no
-- INSERT/UPDATE/DELETE policy, so only SECURITY DEFINER functions can write and
-- nobody — including a superadmin — can edit or erase the history. Verified:
-- INSERT and DELETE both raise 42501 for an authenticated superadmin.
DROP POLICY IF EXISTS data_access_log_select ON data_access_log;
CREATE POLICY data_access_log_select ON data_access_log FOR SELECT
  USING (is_superadmin());

REVOKE ALL ON data_access_log FROM anon, authenticated;
GRANT SELECT ON data_access_log TO authenticated;

-- Never raises: an audit write must not be able to break the call it records.
CREATE OR REPLACE FUNCTION public.log_data_access(
  p_action text, p_org_id uuid DEFAULT NULL, p_detail jsonb DEFAULT NULL)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  INSERT INTO data_access_log (actor_user_id, action, org_id, detail)
  VALUES (auth.uid(), p_action, p_org_id, p_detail);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'log_data_access failed for %: %', p_action, SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_data_access(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE data_access_log IS
  'Article 27 processing log. Append-only: no INSERT/UPDATE/DELETE policy '
  'exists, so only SECURITY DEFINER functions write and history cannot be '
  'edited. Covers superadmin RPCs only — see docs/PROCESSING_RECORD.md for the '
  'direct-PostgREST residual risk.';

-- ── Wire the superadmin RPCs ─────────────────────────────────────────────
-- The five short ones are rebuilt in full below from their LIVE definitions
-- with only the log call added. platform_billing_health / platform_ops_health /
-- platform_retro_cancel_stats are long, so instead of re-transcribing them
-- (the exact risk that produced the 2026-08-17 no-card regression) the DO block
-- at the end splices the call into their live definitions programmatically —
-- their bodies are preserved byte-for-byte by construction.

CREATE OR REPLACE FUNCTION public.platform_stats()
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  PERFORM log_data_access('platform_stats');
  RETURN jsonb_build_object(
    'total_orgs', (SELECT count(*) FROM organisations),
    'total_appointments', (SELECT count(*) FROM appointments),
    'signups_last_30d', (SELECT count(*) FROM organisations WHERE created_at >= now() - interval '30 days'),
    'booking_views_total', (SELECT coalesce(sum(views), 0) FROM booking_page_views),
    'booking_views_30d', (SELECT coalesce(sum(views), 0) FROM booking_page_views
                           WHERE day >= (now() AT TIME ZONE 'Asia/Tbilisi')::date - 30),
    'orgs_by_billing_status', (SELECT coalesce(jsonb_object_agg(billing_status, c), '{}'::jsonb)
                                 FROM (SELECT billing_status, count(*) c FROM organisations GROUP BY billing_status) t));
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_orgs_overview()
  RETURNS TABLE (id uuid, name text, slug text, billing_status text,
                 acquisition_source text, created_at timestamptz,
                 owner_email text, owner_phone text, contact_phone text,
                 member_count integer, usage integer, views integer)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  -- Reads every org's owner phone/email: a cross-tenant read worth recording.
  PERFORM log_data_access('list_orgs_overview', NULL,
    jsonb_build_object('orgs', (SELECT count(*) FROM organisations)));
  RETURN QUERY
    SELECT o.id, o.name::text, o.slug::text, o.billing_status, o.acquisition_source, o.created_at,
           u.email::text, u.phone::text, o.contact_phone,
           (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id), org_usage(o.id),
           (SELECT coalesce(sum(v.views), 0)::int FROM booking_page_views v WHERE v.org_id = o.id)
      FROM organisations o LEFT JOIN auth.users u ON u.id = o.owner_id
     ORDER BY o.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_superadmins()
  RETURNS TABLE (user_id uuid, phone text, email text, created_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  PERFORM log_data_access('list_superadmins');
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

CREATE OR REPLACE FUNCTION public.add_superadmin(p_phone text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
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

  -- Granting platform-wide access to another person is the single most
  -- privileged act available; log the target, not the phone.
  PERFORM log_data_access('add_superadmin', NULL, jsonb_build_object('target_user_id', v_uid));

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_superadmin(p_user_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF (SELECT count(*) FROM superadmins) <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'last_superadmin');
  END IF;

  DELETE FROM superadmins WHERE user_id = p_user_id;
  PERFORM log_data_access('remove_superadmin', NULL, jsonb_build_object('target_user_id', p_user_id));
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- The three long health/stats RPCs: splice, don't retype. Idempotent — skips a
-- function that already carries the call, and refuses to patch blind if the
-- guard it anchors on is missing.
DO $outer$
DECLARE
  r        record;
  v_def    text;
  v_anchor constant text := E'RAISE EXCEPTION ''forbidden'';\n  END IF;';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('platform_billing_health','platform_ops_health','platform_retro_cancel_stats')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF position(v_anchor in v_def) = 0 THEN
      RAISE EXCEPTION 'guard anchor not found in % — refusing to patch blind', r.proname;
    END IF;
    IF position('log_data_access' in v_def) > 0 THEN
      CONTINUE;
    END IF;

    v_def := replace(
      v_def,
      v_anchor,
      v_anchor || E'\n  PERFORM log_data_access(' || quote_literal(r.proname) || E');'
    );

    EXECUTE v_def;
    RAISE NOTICE 'audit logging added to %', r.proname;
  END LOOP;
END
$outer$;
