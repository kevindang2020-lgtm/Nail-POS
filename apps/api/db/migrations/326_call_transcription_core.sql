-- 326_call_transcription_core.sql — the AI Voice Transcription spine (consent → transcript → segments).
-- NEW consent/retention-gated layer that attaches to the existing per-call record (voice_call_outcomes) via
-- (tenant_id, provider_call_id) — no parallel `calls` table. Every row is tenant+branch scoped; provider events
-- are idempotent. Raw transcript text is stored separately from redacted text and access-gated (slice 3).

-- Consent evidence per call (spec: Authorized Voice Conversations Only). Idempotent per (tenant, provider_call_id).
CREATE TABLE IF NOT EXISTS call_consent_records (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  provider               TEXT NOT NULL DEFAULT 'retell',
  provider_call_id       TEXT NOT NULL,
  consent_status         TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (consent_status IN ('granted','declined','not_required','unknown')),
  consent_method         TEXT
                           CHECK (consent_method IS NULL OR consent_method IN
                             ('verbal_recorded','announcement','keypad','provider_recorded','policy_ack','disabled')),
  recording_enabled      BOOLEAN NOT NULL DEFAULT false,
  transcription_enabled  BOOLEAN NOT NULL DEFAULT false,
  announcement_version   TEXT,
  jurisdiction           TEXT,
  initiated_by           TEXT,                    -- 'system' | 'ai' | user id (server-derived)
  consent_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_call_id)
);
CREATE INDEX IF NOT EXISTS idx_call_consent_tenant ON call_consent_records (tenant_id, created_at DESC);

-- Transcript header: one per authorized call. Links to the call via (tenant, provider_call_id).
CREATE TABLE IF NOT EXISTS call_transcripts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  provider               TEXT NOT NULL DEFAULT 'retell',
  provider_call_id       TEXT NOT NULL,
  customer_id            UUID,
  direction              TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  handler                TEXT NOT NULL DEFAULT 'ai' CHECK (handler IN ('ai','human','voicemail','unknown')),
  status                 TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued','processing','partial','completed','low_confidence',
                                             'transcription_disabled','consent_missing','consent_declined',
                                             'recording_disabled','audio_unavailable','provider_error',
                                             'manual_review_required','retention_expired','deleted','failed')),
  primary_language       TEXT,
  language_confidence     NUMERIC(5,4),
  mixed_language         BOOLEAN NOT NULL DEFAULT false,
  redaction_status       TEXT NOT NULL DEFAULT 'pending'
                           CHECK (redaction_status IN ('pending','processing','completed','not_required','failed')),
  raw_available          BOOLEAN NOT NULL DEFAULT false,   -- raw text stored & access-gated (default: not exposed)
  confidence             NUMERIC(5,4),
  duration_seconds       INTEGER,
  segment_count          INTEGER NOT NULL DEFAULT 0,
  provider_transcript_ref TEXT,
  legal_hold             BOOLEAN NOT NULL DEFAULT false,
  retention_expires_at   TIMESTAMPTZ,
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, provider_call_id)
);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_tenant_time ON call_transcripts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_branch      ON call_transcripts (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_status      ON call_transcripts (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_customer    ON call_transcripts (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_call_transcripts_retention   ON call_transcripts (retention_expires_at)
  WHERE retention_expires_at IS NOT NULL AND deleted_at IS NULL AND legal_hold = false;

-- Structured transcript segments. redacted_text is what search/UI use by default; raw_text is access-gated.
CREATE TABLE IF NOT EXISTS call_transcript_segments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  transcript_id          UUID NOT NULL REFERENCES call_transcripts(id) ON DELETE CASCADE,
  seq                    INTEGER NOT NULL,        -- ordering within the transcript
  speaker_label          TEXT,                    -- provider channel/speaker id
  speaker_role           TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (speaker_role IN ('customer','ai_receptionist','human_receptionist',
                                                   'technician','manager','additional_caller','unknown')),
  start_ms               INTEGER,
  end_ms                 INTEGER,
  redacted_text          TEXT NOT NULL DEFAULT '',
  raw_text               TEXT,                    -- access-gated; null unless raw retention authorized
  language               TEXT,
  confidence             NUMERIC(5,4),
  is_final               BOOLEAN NOT NULL DEFAULT true,
  redaction_applied      BOOLEAN NOT NULL DEFAULT false,
  provider_segment_ref   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transcript_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_tenant     ON call_transcript_segments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_transcript ON call_transcript_segments (transcript_id, seq);
