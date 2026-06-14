-- ============================================================
-- 003_indexes.sql
-- Run AFTER 001_tables.sql.
-- Performance indexes for common query patterns.
-- ============================================================


-- ============================================================
-- org_members
-- Critical: get_user_org_ids() is called on EVERY RLS policy
-- evaluation. This index makes it fast.
-- ============================================================
CREATE INDEX idx_org_members_user_id ON org_members(user_id);
CREATE INDEX idx_org_members_org_id  ON org_members(org_id);


-- ============================================================
-- organisations
-- Slug is used by the public booking form on every page load.
-- ============================================================
CREATE INDEX idx_organisations_slug ON organisations(slug);


-- ============================================================
-- services
-- Used by booking form to list services for an org.
-- ============================================================
CREATE INDEX idx_services_org_id        ON services(org_id);
CREATE INDEX idx_services_org_active    ON services(org_id) WHERE is_active = true;


-- ============================================================
-- appointments
-- Primary query patterns:
--   1. Calendar: fetch by org + date range (ordered by scheduled_at)
--   2. Pending approvals: filter by status
--   3. Slot availability: overlap check in get_available_slots()
-- ============================================================
CREATE INDEX idx_appointments_org_scheduled  ON appointments(org_id, scheduled_at);
CREATE INDEX idx_appointments_status         ON appointments(status);
CREATE INDEX idx_appointments_service_id     ON appointments(service_id);
CREATE INDEX idx_appointments_customer_id    ON appointments(customer_id);

-- Partial index for pending approvals (dashboard badge count)
CREATE INDEX idx_appointments_pending ON appointments(org_id)
  WHERE status = 'pending';


-- ============================================================
-- working_hours_overrides
-- Date range lookups when computing availability for a month view.
-- ============================================================
CREATE INDEX idx_wh_overrides_org_date ON working_hours_overrides(org_id, date);


-- ============================================================
-- notifications
-- Realtime subscription and unread badge count.
-- ============================================================
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_unread  ON notifications(user_id)
  WHERE read_at IS NULL;


-- ============================================================
-- customers
-- Looked up by phone on each booking to avoid duplicates.
-- ============================================================
CREATE INDEX idx_customers_phone ON customers(phone_number);


-- ============================================================
-- invitations
-- Token lookup on invitation acceptance.
-- ============================================================
CREATE INDEX idx_invitations_token  ON invitations(token);
CREATE INDEX idx_invitations_org_id ON invitations(org_id);


-- ============================================================
-- sms_log
-- Admin audit queries filtered by org or appointment.
-- ============================================================
CREATE INDEX idx_sms_log_org_id         ON sms_log(org_id);
CREATE INDEX idx_sms_log_appointment_id ON sms_log(appointment_id);


-- ============================================================
-- subscription_payments
-- Org billing history.
-- ============================================================
CREATE INDEX idx_sub_payments_org_id ON subscription_payments(org_id);
