-- ============================================================
-- 009_service_duration_limit.sql
-- Run AFTER 008_one_org_per_user.sql.
--
-- Caps how long a single appointment can be. An admin sets the
-- duration on a service; the appointment snapshots it at booking
-- time (see appointments.duration_minutes). A duration longer than
-- 24 hours (1440 minutes) is almost always a typo and breaks the
-- calendar's day/hour layout, so we reject it at the database level.
--
-- services.duration_minutes already has CHECK (duration_minutes > 0)
-- from 001_tables.sql; here we add the upper bound. The same bound is
-- mirrored on appointments as defence-in-depth, since the value is
-- copied across at booking time.
-- ============================================================

ALTER TABLE services
  ADD CONSTRAINT services_duration_max
  CHECK (duration_minutes <= 1440);

ALTER TABLE appointments
  ADD CONSTRAINT appointments_duration_range
  CHECK (duration_minutes > 0 AND duration_minutes <= 1440);

COMMENT ON CONSTRAINT services_duration_max ON services IS
  'A service may last at most 24 hours (1440 minutes).';
