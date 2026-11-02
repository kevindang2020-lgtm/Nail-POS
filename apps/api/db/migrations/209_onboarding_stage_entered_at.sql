-- 173_onboarding_stage_entered_at.sql
-- Adds a durable "when did this record enter its current stage" timestamp so the oversight dashboard can compute
-- time-in-stage / SLA aging accurately (rather than abusing updated_at, which changes on any edit). Set on every
-- stage transition by the service; backfilled here for existing rows.

ALTER TABLE onboarding_records
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill: the most recent transition INTO the current stage is the truest "entered current stage" time; fall back
-- to created_at when a record has no matching history row (e.g. seeded rows still in application_received).
UPDATE onboarding_records r
SET stage_entered_at = COALESCE(h.entered_at, r.created_at)
FROM (
  SELECT DISTINCT ON (onboarding_id) onboarding_id, created_at AS entered_at
  FROM onboarding_stage_history
  ORDER BY onboarding_id, created_at DESC
) h
WHERE h.onboarding_id = r.id;

CREATE INDEX IF NOT EXISTS idx_onboarding_records_stage_entered_at ON onboarding_records (stage_entered_at);
