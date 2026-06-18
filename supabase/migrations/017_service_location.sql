-- ============================================================
-- 017_service_location.sql
-- Run AFTER 016_accept_invitation.sql.
-- Lets an org configure WHERE a service takes place:
--   * in_person — a physical appointment/meeting; no link needed.
--   * online    — a virtual meeting; an optional meeting link can
--                 be stored and (later) sent to the customer via SMS
--                 once their booking is approved.
-- The link is only meaningful for online services, so we forbid
-- storing one on an in_person service.
-- ============================================================

ALTER TABLE services
  ADD COLUMN location_type text NOT NULL DEFAULT 'in_person'
    CHECK (location_type IN ('in_person', 'online')),
  ADD COLUMN meeting_link text;

ALTER TABLE services
  ADD CONSTRAINT services_meeting_link_online_only
  CHECK (location_type = 'online' OR meeting_link IS NULL);

COMMENT ON COLUMN services.location_type IS
  'Where the service takes place: in_person or online.';
COMMENT ON COLUMN services.meeting_link IS
  'Optional virtual meeting URL for online services; sent to the '
  'customer via SMS after approval. NULL for in_person services.';
