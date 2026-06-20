-- ============================================================
-- 027  Cascade organisation deletion
-- ============================================================
-- appointments.org_id and subscription_payments.org_id were created without
-- ON DELETE CASCADE (001_tables.sql), so DELETE FROM organisations fails with
-- an FK violation — blocking both superadmin org removal and the new
-- self-service account/org deletion (delete-account Edge Function).
--
-- Re-create the FKs with ON DELETE CASCADE so deleting an organisation removes
-- its appointments and subscription history along with the rest of its data
-- (every other org-scoped table already cascades). appointments.service_id is
-- also switched to CASCADE for safety, since services cascade from the org.

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_org_id_fkey,
  ADD CONSTRAINT appointments_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_service_id_fkey,
  ADD CONSTRAINT appointments_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;

ALTER TABLE subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_org_id_fkey,
  ADD CONSTRAINT subscription_payments_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE;
