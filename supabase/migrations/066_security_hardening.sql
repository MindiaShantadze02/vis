-- ============================================================
-- 066_security_hardening.sql
-- Run AFTER 065_anonymize_retention.sql.
--
-- Fixes tenant-isolation / authorization findings from the security audit:
--   HIGH-1  org_members self-promotion (privilege escalation)
--   HIGH-2  any authenticated user could read every org's payment_config/owner_id
--   MED-3   anon could enumerate every org's appointment schedule
--   LOW-4   anon over-exposed columns on org_members
--   LOW-5   cross-org usage info + missing search_path
--   + defense-in-depth grant tightening
--
-- The public booking flow keeps working: its two anon reads that these changes
-- close (availability, confirmation) are moved to SECURITY DEFINER RPCs.
-- ============================================================

-- --------------------------------------------------------
-- HIGH-1: block role / membership changes on org_members unless the caller is
-- the org owner, a superadmin, or an internal/service-role context (auth.uid()
-- null — e.g. delete-account's successor promotion). The app sets role only at
-- INSERT (invitations / accept_invitation), so this breaks no normal flow.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.role    IS DISTINCT FROM OLD.role
   OR NEW.user_id IS DISTINCT FROM OLD.user_id
   OR NEW.org_id  IS DISTINCT FROM OLD.org_id) THEN
    IF NOT (auth.uid() IS NULL
            OR is_superadmin()
            OR get_user_org_role(OLD.org_id) = 'owner') THEN
      RAISE EXCEPTION 'not_authorized: only an owner may change role or membership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON org_members;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();

COMMENT ON FUNCTION prevent_role_escalation IS
  'Blocks org_members.role/user_id/org_id changes unless caller is the org owner, '
  'a superadmin, or an internal service-role context (auth.uid() null). Closes the '
  'member->owner self-promotion path (audit HIGH-1).';

-- --------------------------------------------------------
-- HIGH-2: scope organisations SELECT to own-org + superadmin. Was USING(true),
-- which (with the authenticated column grants) let any logged-in user read every
-- org's payment_config (merchant apiKey/merchantId) + owner_id.
-- Public booking uses get_public_org() (secret-stripped, definer) — unaffected.
-- The one anon consumer of the raw table (booking confirmation) moves to an RPC
-- below.
-- --------------------------------------------------------
-- owner_id = auth.uid() is included so the onboarding insert's RETURNING (the
-- org is read back before the owner's org_members row exists) still resolves,
-- and so an owner always sees their own org. Still fully tenant-isolated.
DROP POLICY IF EXISTS organisations_select ON organisations;
CREATE POLICY organisations_select ON organisations FOR SELECT
  USING (id = ANY (get_user_org_ids()) OR owner_id = auth.uid() OR is_superadmin());

-- Anon-safe booking confirmation: appointment public fields + org public fields
-- + service. Replaces the anon `appointments … organisations(...)` embed.
CREATE OR REPLACE FUNCTION get_booking_confirmation(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id',               a.id,
    'scheduled_at',     a.scheduled_at,
    'duration_minutes', a.duration_minutes,
    'status',           a.status,
    'payment_method',   a.payment_method,
    'organisations', jsonb_build_object(
      'name',          o.name,
      'slug',          o.slug,
      'booking_theme', o.booking_theme,
      'contact_phone', o.contact_phone
    ),
    'services', CASE WHEN s.id IS NOT NULL
      THEN jsonb_build_object('name', s.name, 'price', s.price)
      ELSE NULL END
  )
  FROM appointments a
  JOIN organisations o ON o.id = a.org_id
  LEFT JOIN services s ON s.id = a.service_id
  WHERE a.id = p_appointment_id;
$$;

COMMENT ON FUNCTION get_booking_confirmation IS
  'Public booking-confirmation view: appointment + org public fields + service, by '
  'appointment id. Definer so it survives the org-scoped organisations RLS (HIGH-2).';

GRANT EXECUTE ON FUNCTION get_booking_confirmation(uuid) TO anon, authenticated;

-- --------------------------------------------------------
-- MED-3: stop anon reading appointments directly (was USING(true) across all
-- orgs). The booking availability check moves to an org-scoped RPC.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION get_org_busy_slots(
  p_org_id uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
RETURNS TABLE(scheduled_at timestamptz, duration_minutes int, service_id uuid, staff_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.scheduled_at, a.duration_minutes::int, a.service_id, a.staff_id
  FROM appointments a
  WHERE a.org_id = p_org_id
    AND a.scheduled_at >= p_from
    AND a.scheduled_at <= p_to
    AND a.status NOT IN ('rejected','cancelled');
$$;

COMMENT ON FUNCTION get_org_busy_slots IS
  'Busy time-ranges (no PII) for one org in a window, for public availability '
  'computation. Definer + org-scoped so anon cannot enumerate other orgs (MED-3).';

GRANT EXECUTE ON FUNCTION get_org_busy_slots(uuid, timestamptz, timestamptz) TO anon, authenticated;

DROP POLICY IF EXISTS appointments_anon_select ON appointments;
REVOKE SELECT ON appointments FROM anon;

-- --------------------------------------------------------
-- LOW-4: drop anon's over-exposed org_members columns. The booking staff embed
-- only needs id, display_name, title, is_bookable, sort_order, avatar_url.
-- --------------------------------------------------------
REVOKE SELECT (user_id, role, invited_by, joined_at, created_at, org_id)
  ON org_members FROM anon;

-- --------------------------------------------------------
-- LOW-5: gate org_usage_info to members/superadmin + set search_path.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION org_usage_info(p_org_id uuid)
RETURNS TABLE(tier text, used int, appt_limit int, period_start timestamptz, period_end timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (p_org_id = ANY (get_user_org_ids()) OR is_superadmin()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
    SELECT
      o.subscription_tier,
      org_usage(o.id),
      (pc.tier_limits ->> o.subscription_tier)::int,
      current_period_start(o.usage_anchor),
      current_period_start(o.usage_anchor) + interval '1 month'
    FROM organisations o
    CROSS JOIN platform_config pc
    WHERE o.id = p_org_id AND pc.id = 1;
END;
$$;

-- --------------------------------------------------------
-- Defense-in-depth: remove grants no anon/authenticated client path uses
-- (writes to these tables happen only via the service role; RLS already blocks).
-- --------------------------------------------------------
REVOKE UPDATE ON customers FROM anon, authenticated;
REVOKE INSERT, UPDATE ON payment_log, subscription_payments, pending_bookings FROM anon, authenticated;
