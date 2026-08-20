-- ============================================================
-- 20260831150000_billing_suspension_human_review.sql
-- Applied to cloud as: billing_suspension_human_review (2026-08-20)
--
-- Article 19: a business is suspended from trading by a solely automated
-- process — the dunning run flips billing_status, and org_can_accept_appointment
-- then blocks every booking. Art. 19 requires a human-review path, the right to
-- state a case, and the right to challenge. Until now the only way out was
-- paying (docs/COMPLIANCE_GE_DPL.md, "Automated decisions").
--
-- billing_review_until is the hold: while it is in the future the org can trade
-- again despite past_due/suspended, so an accepted appeal actually DOES
-- something rather than merely being recorded. billing_status is left untouched
-- — the debt is not forgiven, only the block is lifted while it is looked at.
-- ============================================================
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS billing_review_until timestamptz;

COMMENT ON COLUMN organisations.billing_review_until IS
  'Set by a superadmin when a billing-suspension appeal is accepted (Art. 19 '
  'human review). While in the future, org_can_accept_appointment returns true '
  'despite past_due/suspended. Tenant-writable would be a billing bypass — '
  'frozen in prevent_billing_self_update.';

-- ⚠️ organisations_update has NO column list, so this trigger IS the
-- column-level access control. Without the new clause, any owner could grant
-- themselves an unlimited trading holiday — the same shape of bug found on
-- usage_anchor and owner_id in the 2026-08-19 sweep. Verified: an owner PATCH
-- raises not_authorized.
CREATE OR REPLACE FUNCTION public.prevent_billing_self_update()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_platform boolean := (
    auth.uid() IS NULL OR is_superadmin()
    OR coalesce(current_setting('app.internal_billing', true), '') = '1'
  );
BEGIN
  IF (NEW.billing_status IS DISTINCT FROM OLD.billing_status) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: billing_status changes only via payment or superadmin';
  END IF;
  IF (NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: billing_exempt is set by the platform, not the organisation';
  END IF;
  IF (NEW.usage_anchor IS DISTINCT FROM OLD.usage_anchor) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: usage_anchor is the billing period anchor, set by the platform';
  END IF;
  IF (NEW.owner_id IS DISTINCT FROM OLD.owner_id) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: owner_id cannot be reassigned by the organisation';
  END IF;
  IF (NEW.billing_review_until IS DISTINCT FROM OLD.billing_review_until) AND NOT v_platform THEN
    RAISE EXCEPTION 'not_authorized: billing_review_until is granted by the platform, not the organisation';
  END IF;
  RETURN NEW;
END;
$function$;

-- The hold joins billing_exempt and 'active' as a reason a booking may proceed.
CREATE OR REPLACE FUNCTION public.org_can_accept_appointment(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
  SELECT billing_exempt
      OR billing_status = 'active'
      OR (billing_review_until IS NOT NULL AND billing_review_until > now())
    FROM organisations WHERE id = p_org_id;
$function$;

-- ── The appeal queue ─────────────────────────────────────────────────────
-- Mirrors the setup_requests pattern: the business raises it, a superadmin
-- decides, and the decision is recorded.
CREATE TABLE IF NOT EXISTS billing_appeals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requested_by uuid,
  message      text NOT NULL,
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','accepted','declined')),
  decided_by   uuid,
  decided_at   timestamptz,
  review_until timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_appeals_open ON billing_appeals (status, created_at DESC);

ALTER TABLE billing_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_appeals_select ON billing_appeals;
CREATE POLICY billing_appeals_select ON billing_appeals FOR SELECT
  USING ((org_id = ANY (get_user_org_ids())) OR is_superadmin());

REVOKE ALL ON billing_appeals FROM anon, authenticated;
GRANT SELECT ON billing_appeals TO authenticated;

-- Owner-only, and one open appeal at a time so the queue can't be flooded.
CREATE OR REPLACE FUNCTION public.request_billing_review(p_org_id uuid, p_message text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_id uuid; v_msg text;
BEGIN
  -- coalesce: get_user_org_role returns NULL for a foreign org, and
  -- `NOT (NULL)` is NULL, which would fail OPEN (see fix_owner_guard_three_valued_logic).
  IF NOT coalesce(get_user_org_role(p_org_id) = 'owner', false) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_msg := nullif(btrim(coalesce(p_message, '')), '');
  IF v_msg IS NULL OR length(v_msg) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_too_short');
  END IF;
  IF length(v_msg) > 1000 THEN v_msg := left(v_msg, 1000); END IF;

  IF EXISTS (SELECT 1 FROM billing_appeals WHERE org_id = p_org_id AND status = 'open') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_open');
  END IF;

  INSERT INTO billing_appeals (org_id, requested_by, message)
  VALUES (p_org_id, auth.uid(), v_msg)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- Superadmin decision. Accepting grants a dated hold; declining records the
-- refusal so the business gets an answer rather than silence.
CREATE OR REPLACE FUNCTION public.decide_billing_appeal(
  p_id uuid, p_accept boolean, p_days int DEFAULT 14)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid; v_until timestamptz;
BEGIN
  IF NOT coalesce(is_superadmin(), false) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT org_id INTO v_org FROM billing_appeals WHERE id = p_id AND status = 'open';
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_open'); END IF;

  IF p_accept THEN
    v_until := now() + make_interval(days => greatest(coalesce(p_days, 14), 1));
    PERFORM set_config('app.internal_billing', '1', true);  -- let the trigger through
    UPDATE organisations SET billing_review_until = v_until WHERE id = v_org;
  END IF;

  UPDATE billing_appeals
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         decided_by = auth.uid(), decided_at = now(), review_until = v_until
   WHERE id = p_id;

  PERFORM log_data_access('decide_billing_appeal', v_org,
    jsonb_build_object('appeal_id', p_id, 'accepted', p_accept, 'review_until', v_until));

  RETURN jsonb_build_object('ok', true, 'review_until', v_until);
END;
$function$;

REVOKE ALL ON FUNCTION public.request_billing_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_billing_appeal(uuid, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_billing_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_billing_appeal(uuid, boolean, int) TO authenticated;
