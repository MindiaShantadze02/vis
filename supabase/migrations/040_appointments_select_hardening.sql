-- ============================================================
-- 040_appointments_select_hardening.sql
-- Security fix C2: the old appointments SELECT policy was
-- `USING (true)`, letting any caller (incl. anon with the public
-- key) read EVERY appointment for EVERY org — including notes,
-- admin_notes, payment_reference, customer_id and payment_*.
--
-- New model:
--   * authenticated  → only their own org's rows (full columns),
--                      closing cross-tenant reads for logged-in users.
--   * anon           → still needs any org's rows so the public
--                      booking form can compute slot availability,
--                      but restricted via column grants to the
--                      non-sensitive booking columns only.
-- ============================================================

-- Replace the blanket SELECT policy with role-scoped policies.
DROP POLICY IF EXISTS "appointments_select" ON appointments;

-- Logged-in users: only their org's appointments (or superadmin).
CREATE POLICY "appointments_member_select"
  ON appointments FOR SELECT
  TO authenticated
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

-- Anonymous booking visitors: row access stays open (availability for any
-- org by slug), but column grants below limit which fields they can read.
CREATE POLICY "appointments_anon_select"
  ON appointments FOR SELECT
  TO anon
  USING (true);

-- Column-level privileges: drop anon's blanket SELECT and re-grant only the
-- columns the public booking flow actually reads (availability in Step 2/3 and
-- the confirmation page). This keeps notes, admin_notes, payment_reference,
-- customer_id, payment_status and payment_provider invisible to anon.
REVOKE SELECT ON appointments FROM anon;
GRANT SELECT (
  id,
  org_id,
  service_id,
  staff_id,
  scheduled_at,
  duration_minutes,
  status,
  payment_method
) ON appointments TO anon;

-- authenticated keeps full-table SELECT (granted by Supabase defaults); its row
-- visibility is now scoped by appointments_member_select above.
