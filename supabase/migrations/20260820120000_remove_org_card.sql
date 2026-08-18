-- ============================================================
-- 20260820120000_remove_org_card.sql
--
-- Let a business take its card off file. store_org_card (20260724150000) could
-- only ever REPLACE the default card — there was no way to end up with none,
-- so an owner who wanted their card details off the platform had no route to it
-- short of asking support.
--
-- Mirrors store_org_card exactly, minus the insert: the row is retired
-- (is_default = false, status = 'removed') rather than deleted, so the payment
-- history behind past charges stays intact and the partial-unique default index
-- is freed for a future card.
--
-- Authorisation is the owner-RPC pattern used by pay_org_outstanding: SECURITY
-- DEFINER (org_payment_methods has no client write policy) with an explicit
-- membership check inside, granted to `authenticated`. No edge function needed —
-- unlike save-card there is no token to tokenise or validate.
--
-- DELIBERATELY allowed while money is owed. Removing the card does not dodge
-- collection: charge_billing_period treats a due charge with no card on file as
-- an uncollectable failure and routes it into dunning (20260729120000), so the
-- org still goes past_due → suspended and still gets blocked from taking
-- bookings. Refusing removal would just trap the owner's card details on a
-- platform they are trying to leave, which is the worse failure.
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_org_card(p_org_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n int;
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE org_payment_methods
     SET is_default = false, status = 'removed'
   WHERE org_id = p_org_id AND is_default AND status = 'active';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- False when there was nothing on file: idempotent, so a double-click or a
  -- stale page is a no-op rather than an error.
  RETURN v_n > 0;
END;
$function$;

COMMENT ON FUNCTION public.remove_org_card IS
  'Takes the org''s default card off file: retires the row (status ''removed'') '
  'rather than deleting it, so charge history survives. Members of the org and '
  'superadmins only. Returns false when no card was on file (idempotent). '
  'Allowed even while a bill is outstanding — no_card_dunning (20260729120000) '
  'still routes the unpaid charge into dunning, so this cannot dodge collection.';

REVOKE ALL ON FUNCTION public.remove_org_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_org_card(uuid) TO authenticated;
