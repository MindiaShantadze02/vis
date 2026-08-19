-- ============================================================
-- 20260827120000_pending_booking_atomic_claim.sql
--
-- payment-webhook's idempotency guard was a read-then-write: it read
-- pending_bookings.status near the top, and only wrote 'consumed' after creating
-- the customer and the appointment. Duplicate callbacks — which real gateways
-- send routinely as retries, and which the mock checkout page can also produce —
-- all read 'pending' and all proceeded to fulfil.
--
-- Measured on the live mock flow, 10 concurrent callbacks for ONE payment:
--   * 2 appointments created  (double booking against a single charge)
--   * 8 orphaned customer rows (created before the appointment insert, never
--     cleaned up; invisible even to the business, since customers_select
--     requires a linked appointment)
--   * pending_bookings ended 'failed' while two live appointments existed
--   * payment_log ended 'refunded' with error 'verification_required'
--
-- That last one is the damaging part. The losing callbacks fail the appointment
-- insert (the winner's insert consumed the booking OTP), and the webhook treats
-- a failed fulfilment as "we took money for a booking that does not exist" and
-- auto-refunds. So a booking that SUCCEEDED had its money returned while both
-- appointments stayed live and billable — the business delivers the service
-- twice, for free.
--
-- claim_pending_booking makes check-and-claim a single statement. Exactly one
-- caller moves the row 'pending' -> 'processing' and does the work; the rest get
-- claimed=false plus the current status and return without side effects.
-- ============================================================

ALTER TABLE pending_bookings DROP CONSTRAINT IF EXISTS pending_bookings_status_check;
ALTER TABLE pending_bookings ADD CONSTRAINT pending_bookings_status_check
  CHECK (status = ANY (ARRAY['pending','processing','consumed','failed']));

CREATE OR REPLACE FUNCTION public.claim_pending_booking(p_id uuid, p_ref text)
  RETURNS TABLE (claimed boolean, current_status text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_status text;
BEGIN
  -- Winner: exactly one caller moves it out of 'pending'.
  UPDATE pending_bookings
     SET status = 'processing'
   WHERE id = p_id AND payment_reference = p_ref AND status = 'pending';

  IF FOUND THEN
    RETURN QUERY SELECT true, 'processing'::text;
    RETURN;
  END IF;

  -- Loser (or unknown id/ref): report what the booking actually is.
  SELECT pb.status INTO v_status
    FROM pending_bookings pb WHERE pb.id = p_id AND pb.payment_reference = p_ref;

  RETURN QUERY SELECT false, v_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_booking(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_booking(uuid, text) TO service_role;

COMMENT ON FUNCTION public.claim_pending_booking IS
  'Atomically claims a parked booking for fulfilment. Returns claimed=true to '
  'exactly one concurrent caller; everyone else gets claimed=false plus the '
  'current status. Prevents duplicate gateway callbacks from creating duplicate '
  'appointments and spuriously auto-refunding a booking that succeeded.';

-- ⚠️ The DB half alone changes nothing: payment-webhook must be redeployed to
--    call this RPC. Until then the race is still live.
