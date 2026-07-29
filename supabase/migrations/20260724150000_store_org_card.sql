-- ============================================================
-- 20260724150000_store_org_card.sql  (BILLING_PLAN T1.4)
--
-- Card on file: save the provider token + display metadata for an org's
-- post-paid charges. store_org_card is the single writer (org_payment_methods
-- has no client write policy) — it keeps the "one default active card per org"
-- invariant by retiring the previous default before inserting the new one.
-- Called by the save-card edge function (service role) AFTER it has verified the
-- caller's org membership. Never stores a PAN — only the token + last4/brand/exp.
-- ============================================================
CREATE OR REPLACE FUNCTION store_org_card(
  p_org_id     uuid,
  p_provider   text,
  p_token      text,
  p_last4      text,
  p_brand      text,
  p_expires_at date
)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF p_org_id IS NULL OR coalesce(p_token, '') = '' THEN
    RAISE EXCEPTION 'invalid_card';
  END IF;

  -- Retire the current default (kept as history, status 'removed') so the
  -- partial-unique default index never collides.
  UPDATE org_payment_methods
     SET is_default = false, status = 'removed'
   WHERE org_id = p_org_id AND is_default AND status = 'active';

  INSERT INTO org_payment_methods (org_id, provider, token, last4, brand, expires_at, is_default, status)
  VALUES (p_org_id, coalesce(p_provider, 'mock'), p_token, p_last4, p_brand, p_expires_at, true, 'active')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION store_org_card(uuid, text, text, text, text, date) FROM PUBLIC, anon, authenticated;

-- Owners read only the card's DISPLAY metadata — never the provider token.
-- (Revoke the table grant first, else the column-level REVOKE is a no-op while
-- the role still holds table SELECT.) get_org_billing_status is SECURITY DEFINER
-- so it still reads what it needs.
REVOKE SELECT ON org_payment_methods FROM authenticated;
GRANT SELECT (id, org_id, provider, last4, brand, expires_at, status, is_default, created_at)
  ON org_payment_methods TO authenticated;
