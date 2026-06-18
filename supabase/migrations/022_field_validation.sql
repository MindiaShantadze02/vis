-- ============================================================
-- 022_field_validation.sql
-- Run AFTER 021_appointment_notifications_guard.sql.
--
-- Enforces the same field rules the client applies (see
-- client/src/lib/validation.ts: FIELD_LIMITS + the per-form checks)
-- at the database level. Most writes reach the tables directly via
-- RLS (bookings insert customers/appointments, settings pages update
-- organisations/services/overrides), bypassing any edge function, so
-- the database is the only place these rules can be guaranteed.
--
-- Lengths mirror FIELD_LIMITS; varchar(N) columns already cap their
-- maximum, so for those we only add the lower bounds / format rules
-- that the column type can't express.
--
-- All constraints are added NOT VALID (the repo convention, see
-- 010_phone_format.sql): they apply to every new insert/update but
-- leave any pre-existing rows untouched rather than failing the
-- migration on legacy data.
-- ============================================================

-- ── Names: required, at least 2 trimmed characters ──────────────
-- Mirrors the "min 2 chars" rule on the business name, service name
-- and customer first name. varchar(255)/varchar(100) already cap the
-- upper bound, so we only add the lower bound here.
ALTER TABLE organisations
  ADD CONSTRAINT organisations_name_min_length
  CHECK (char_length(trim(name)) >= 2) NOT VALID;

ALTER TABLE services
  ADD CONSTRAINT services_name_min_length
  CHECK (char_length(trim(name)) >= 2) NOT VALID;

ALTER TABLE customers
  ADD CONSTRAINT customers_first_name_min_length
  CHECK (char_length(trim(first_name)) >= 2) NOT VALID;

-- ── Free-text length caps (text columns have no built-in limit) ──
ALTER TABLE organisations
  ADD CONSTRAINT organisations_description_max_length
  CHECK (description IS NULL OR char_length(description) <= 1000) NOT VALID;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_notes_max_length
  CHECK (notes IS NULL OR char_length(notes) <= 500) NOT VALID;

ALTER TABLE working_hours_overrides
  ADD CONSTRAINT working_hours_overrides_note_max_length
  CHECK (note IS NULL OR char_length(note) <= 300) NOT VALID;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_email_max_length
  CHECK (email IS NULL OR char_length(email) <= 254) NOT VALID;

-- ── Price: non-negative (numeric(10,2) already caps the maximum) ─
ALTER TABLE services
  ADD CONSTRAINT services_price_non_negative
  CHECK (price >= 0) NOT VALID;

-- ── Meeting link: required for online services, well-formed, capped ─
-- 017 already forbids a link on in_person services. Here we add the
-- complement (online services must carry a link) plus an http(s) URL
-- shape and a length cap, mirroring isValidUrl + FIELD_LIMITS.meetingLink.
ALTER TABLE services
  ADD CONSTRAINT services_online_needs_link
  CHECK (location_type <> 'online' OR meeting_link IS NOT NULL) NOT VALID;

ALTER TABLE services
  ADD CONSTRAINT services_meeting_link_format
  CHECK (meeting_link IS NULL OR meeting_link ~* '^https?://') NOT VALID;

ALTER TABLE services
  ADD CONSTRAINT services_meeting_link_max_length
  CHECK (meeting_link IS NULL OR char_length(meeting_link) <= 500) NOT VALID;

COMMENT ON CONSTRAINT organisations_name_min_length ON organisations IS
  'Business name must be at least 2 non-space characters (mirrors client).';
COMMENT ON CONSTRAINT services_online_needs_link ON services IS
  'Online services must have a meeting link; in_person services must not (017).';
