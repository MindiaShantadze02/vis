-- ============================================================
-- 094_waitlist_offer_fks.sql
-- Run AFTER 093_waitlist.sql.
--
-- 093 created waitlist_offers.service_id / staff_id without FK constraints, so
-- PostgREST couldn't embed `service:services(...)` / `staff:org_members(...)` on
-- an offer — the claim-waitlist edge fn's offer query errored and returned 404.
-- Add the FKs (093's CREATE TABLE is also patched inline for fresh installs).
-- ============================================================

ALTER TABLE waitlist_offers
  ADD CONSTRAINT waitlist_offers_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  ADD CONSTRAINT waitlist_offers_staff_id_fkey   FOREIGN KEY (staff_id)   REFERENCES org_members(id) ON DELETE SET NULL;
