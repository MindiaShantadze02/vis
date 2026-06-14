-- ============================================================
-- 004_rls.sql
-- Run AFTER 002_functions.sql (requires helper functions).
-- Enables RLS on all tables and creates all access policies.
-- ============================================================
-- Key design rules:
--   1. get_user_org_ids() + is_superadmin() are SECURITY DEFINER
--      so they bypass RLS on the tables they query — no circular
--      policy evaluation.
--   2. Public tables (services, working_hours_*) have unrestricted
--      SELECT so the booking form works without auth.
--   3. Edge Functions use the service role key and bypass RLS
--      entirely — they do their own validation in application code.
-- ============================================================


-- ============================================================
-- Enable RLS
-- ============================================================
ALTER TABLE organisations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE services                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_hours_template   ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_hours_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_log                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config          ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- ORGANISATIONS
-- Public SELECT — /book/:slug needs to load org without auth.
-- ============================================================
CREATE POLICY "organisations_select"
  ON organisations FOR SELECT
  USING (true);

-- Any authenticated user can create an org during onboarding.
-- auth.uid() IS NOT NULL is more reliable than auth.role() = 'authenticated'.
CREATE POLICY "organisations_insert"
  ON organisations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only the org owner (or superadmin) can update.
CREATE POLICY "organisations_update"
  ON organisations FOR UPDATE
  USING (get_user_org_role(id) = 'owner' OR is_superadmin());

-- Only the superadmin can delete an organisation.
CREATE POLICY "organisations_delete"
  ON organisations FOR DELETE
  USING (is_superadmin());


-- ============================================================
-- SERVICES
-- Public SELECT — the booking form reads services without auth.
-- ============================================================
CREATE POLICY "services_public_select"
  ON services FOR SELECT
  USING (true);

CREATE POLICY "services_member_insert"
  ON services FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "services_member_update"
  ON services FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

-- Only owners can delete a service (it may be referenced by appointments).
CREATE POLICY "services_owner_delete"
  ON services FOR DELETE
  USING (get_user_org_role(org_id) = 'owner' OR is_superadmin());


-- ============================================================
-- CUSTOMERS
-- INSERT is public: guest booking creates a customer row.
-- SELECT is restricted: only org members who have appointments
-- with that customer can see them.
-- ============================================================
CREATE POLICY "customers_select"
  ON customers FOR SELECT
  USING (
    is_superadmin()
    OR EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.customer_id = customers.id
        AND a.org_id = ANY(get_user_org_ids())
    )
  );

-- Public insert: guest booking flow creates the customer record.
-- The Edge Function upserts by phone to avoid duplicates.
CREATE POLICY "customers_public_insert"
  ON customers FOR INSERT
  WITH CHECK (true);


-- ============================================================
-- ORG_MEMBERS
-- ============================================================
CREATE POLICY "org_members_select"
  ON org_members FOR SELECT
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

-- Owners can add members, OR a user can add themselves as owner during onboarding
-- (before they're in org_members, get_user_org_role returns null, so we fall back
-- to checking that they are the organisations.owner_id).
CREATE POLICY "org_members_insert"
  ON org_members FOR INSERT
  WITH CHECK (
    get_user_org_role(org_id) = 'owner'
    OR is_superadmin()
    OR (
      user_id = auth.uid()
      AND role = 'owner'
      AND EXISTS (
        SELECT 1 FROM organisations o WHERE o.id = org_id AND o.owner_id = auth.uid()
      )
    )
  );

-- Owner can remove anyone; members can remove themselves.
CREATE POLICY "org_members_delete"
  ON org_members FOR DELETE
  USING (
    get_user_org_role(org_id) = 'owner'
    OR user_id = auth.uid()
    OR is_superadmin()
  );


-- ============================================================
-- INVITATIONS
-- ============================================================
CREATE POLICY "invitations_member_select"
  ON invitations FOR SELECT
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());

CREATE POLICY "invitations_owner_insert"
  ON invitations FOR INSERT
  WITH CHECK (get_user_org_role(org_id) = 'owner' OR is_superadmin());

CREATE POLICY "invitations_owner_delete"
  ON invitations FOR DELETE
  USING (get_user_org_role(org_id) = 'owner' OR is_superadmin());

-- Accepting an invitation (accepted_at update) is handled by
-- the invite-admin Edge Function using the service role key.


-- ============================================================
-- WORKING_HOURS_TEMPLATE
-- Public SELECT — booking form needs working hours to show slots.
-- ============================================================
CREATE POLICY "wh_template_public_select"
  ON working_hours_template FOR SELECT
  USING (true);

CREATE POLICY "wh_template_member_insert"
  ON working_hours_template FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "wh_template_member_update"
  ON working_hours_template FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));


-- ============================================================
-- WORKING_HOURS_OVERRIDES
-- Public SELECT — same reason as template.
-- ============================================================
CREATE POLICY "wh_overrides_public_select"
  ON working_hours_overrides FOR SELECT
  USING (true);

CREATE POLICY "wh_overrides_member_insert"
  ON working_hours_overrides FOR INSERT
  WITH CHECK (org_id = ANY(get_user_org_ids()));

CREATE POLICY "wh_overrides_member_update"
  ON working_hours_overrides FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));

CREATE POLICY "wh_overrides_member_delete"
  ON working_hours_overrides FOR DELETE
  USING (org_id = ANY(get_user_org_ids()));


-- ============================================================
-- APPOINTMENTS
-- INSERT is public: guest booking flow writes directly.
-- Real validation (slot availability, limits) is in Edge Function.
-- ============================================================
-- Public SELECT — UUID is 128-bit random so unguessable in practice.
-- Org members see their org's appointments; guests see the confirmation
-- page for their own booking (they hold the UUID).
CREATE POLICY "appointments_select"
  ON appointments FOR SELECT
  USING (true);

-- Guest booking inserts directly. Edge Function validates slots
-- and increments appointments_used_this_month atomically.
CREATE POLICY "appointments_public_insert"
  ON appointments FOR INSERT
  WITH CHECK (true);

-- Approval, rejection, notes — only org members.
CREATE POLICY "appointments_member_update"
  ON appointments FOR UPDATE
  USING (org_id = ANY(get_user_org_ids()));


-- ============================================================
-- NOTIFICATIONS
-- Each user only sees their own notifications.
-- INSERT is done by Edge Functions via service role (no policy needed).
-- ============================================================
CREATE POLICY "notifications_user_select"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

-- Marking as read
CREATE POLICY "notifications_user_update"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());


-- ============================================================
-- SMS_LOG
-- Superadmin read-only. All inserts via service role in Edge Functions.
-- ============================================================
CREATE POLICY "sms_log_superadmin_select"
  ON sms_log FOR SELECT
  USING (is_superadmin());


-- ============================================================
-- SUBSCRIPTION_PAYMENTS
-- Org members can see their own billing history.
-- Inserts via service role in payment webhook Edge Function.
-- ============================================================
CREATE POLICY "sub_payments_member_select"
  ON subscription_payments FOR SELECT
  USING (org_id = ANY(get_user_org_ids()) OR is_superadmin());


-- ============================================================
-- PLATFORM_CONFIG
-- Superadmin only. The single row contains SMS config and
-- tier settings — not for org users.
-- ============================================================
CREATE POLICY "platform_config_superadmin_select"
  ON platform_config FOR SELECT
  USING (is_superadmin());

CREATE POLICY "platform_config_superadmin_update"
  ON platform_config FOR UPDATE
  USING (is_superadmin());
