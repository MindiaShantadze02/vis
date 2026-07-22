-- Per-service recurrence defaults. Recurring appointments already exist (owner
-- creates a series via the Add-Appointment dialog → create_recurrence_series).
-- These columns let an owner mark a service as recurring-by-default and set its
-- default cadence + occurrence count from Settings → Services, so the dialog
-- pre-fills/enables the repeat options when that service is picked. Owner-side
-- only; no change to occurrence generation or the guest booking flow.
--
-- Mirrors the per-service deposit pattern (nullable config columns; a flag +
-- CHECK-constrained values matching create_recurrence_series' own validation).

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS recurring_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_cadence text
    CHECK (recurring_cadence IN ('weekly', 'biweekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS recurring_occurrence_count int
    CHECK (recurring_occurrence_count BETWEEN 1 AND 52);
