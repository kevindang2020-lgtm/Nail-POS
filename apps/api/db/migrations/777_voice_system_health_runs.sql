-- 777_voice_system_health_runs.sql — Voice Transcription Search + Call History guides (Nov 3 2026). Additive only.
-- Rollback: DROP TABLE voice_system_health_runs.
--
-- Search and Call History read the existing tables (call_transcripts, call_transcript_segments — redacted text only,
-- call_transcript_intelligence, voice_followup_reviews). This adds only the evidence table for the read-only
-- "Check Voice Transcription System": each run's overall state and checks, so "last passed" is a fact.
CREATE TABLE IF NOT EXISTS voice_system_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voice_system_health_recent ON voice_system_health_runs (tenant_id, created_at DESC);
