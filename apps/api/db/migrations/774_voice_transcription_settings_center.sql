-- 774_voice_transcription_settings_center.sql — Voice Transcription Settings guide (Nov 2 2026). Additive only.
-- Rollback: DROP TABLE voice_settings_health_runs, voice_transcript_access_events, voice_transcription_settings_history;
--           ALTER TABLE voice_transcription_settings DROP COLUMN version.
--
-- The settings row (migration 330) stays the one source of the salon's transcription policy. This adds:
--   • version — the editor sends back the version it read; a stale save is refused;
--   • voice_transcription_settings_history — append-only before/after of every save, with what it did to stored data
--     (transcripts whose deletion date moved, raw text purged);
--   • voice_transcript_access_events — every view of raw (pre-redaction) text, written BEFORE the text is returned;
--   • voice_settings_health_runs — the read-only "Check Voice Transcription Settings" run's evidence.
ALTER TABLE voice_transcription_settings ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS voice_transcription_settings_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  version        INT NOT NULL,
  actor_user_id  UUID,
  actor_role     TEXT,
  before_state   JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state    JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_keys   TEXT[] NOT NULL DEFAULT '{}',
  impact         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_voice_settings_history ON voice_transcription_settings_history (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS voice_transcript_access_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  branch_id      UUID,
  transcript_id  UUID NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'view_raw' CHECK (kind IN ('view_raw')),
  actor_user_id  UUID,
  actor_role     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_voice_access_events ON voice_transcript_access_events (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS voice_settings_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_voice_health_recent ON voice_settings_health_runs (tenant_id, created_at DESC);
