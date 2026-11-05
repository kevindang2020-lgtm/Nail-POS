-- 328_call_transcription_intelligence.sql — structured, machine-readable call intelligence per transcript
-- (quick + detailed summary, intents, appointment extraction, unresolved items, sentiment). Derived from REDACTED
-- text only. One row per transcript (idempotent on transcript_id). This is the transcription-side intelligence;
-- the receptionist-side short summary continues to live in voice_call_outcomes — both join on provider_call_id.
CREATE TABLE IF NOT EXISTS call_transcript_intelligence (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  transcript_id          UUID NOT NULL REFERENCES call_transcripts(id) ON DELETE CASCADE,
  provider_call_id       TEXT,
  quick_summary          TEXT NOT NULL DEFAULT '',
  detailed_summary       TEXT,
  detailed_source        TEXT CHECK (detailed_source IS NULL OR detailed_source IN ('ai','fallback')),
  intents                JSONB NOT NULL DEFAULT '[]'::jsonb,
  appointment            JSONB NOT NULL DEFAULT '{}'::jsonb,
  unresolved             JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment              TEXT,
  extraction_confidence  NUMERIC(5,4),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transcript_id)
);
CREATE INDEX IF NOT EXISTS idx_call_intel_tenant   ON call_transcript_intelligence (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_intel_provider ON call_transcript_intelligence (tenant_id, provider_call_id);
