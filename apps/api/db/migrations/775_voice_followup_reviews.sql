-- 775_voice_followup_reviews.sql — Voice Transcription Follow-Ups guide (Nov 2 2026). Additive only.
-- Rollback: DROP TABLE voice_followup_health_runs, voice_followup_reviews.
--
-- The extracted items stay where they are (call_transcript_intelligence.unresolved) and tasks stay in the ONE task system
-- (ai_receptionist_follow_ups, migrations 303 / 759). This adds only the staff decision on each extracted item —
-- append-only, newest row wins — so an item can finally leave "open": turned into a task, dismissed (with a reason), or
-- reopened. And the evidence table for the read-only "Check Voice Follow-Up System".
CREATE TABLE IF NOT EXISTS voice_followup_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  branch_id      UUID,
  transcript_id  UUID NOT NULL,
  item_type      TEXT NOT NULL,
  decision       TEXT NOT NULL CHECK (decision IN ('task_created', 'dismissed', 'reopened')),
  follow_up_id   UUID,
  reason         TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  actor_user_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (decision <> 'task_created' OR follow_up_id IS NOT NULL),
  CHECK (decision = 'task_created' OR length(trim(coalesce(reason, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS ix_voice_followup_reviews_item ON voice_followup_reviews (tenant_id, transcript_id, item_type, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_followup_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voice_followup_health_recent ON voice_followup_health_runs (tenant_id, created_at DESC);
