-- 327_call_transcription_redaction.sql — redaction bookkeeping. redaction_categories summarizes what was stripped
-- from a call; call_redaction_events is the append-only audit of each redaction pass (spec: Privacy & Redaction).
-- Raw segment text already has its own column (call_transcript_segments.raw_text, migration 326) and is written
-- ONLY when raw retention is authorized; it is never exposed without the view_raw permission.
ALTER TABLE call_transcripts ADD COLUMN IF NOT EXISTS redaction_categories JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS call_redaction_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  transcript_id      UUID NOT NULL REFERENCES call_transcripts(id) ON DELETE CASCADE,
  categories         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["card","cvv","ssn"]
  segments_redacted  INTEGER NOT NULL DEFAULT 0,
  raw_retained       BOOLEAN NOT NULL DEFAULT false,       -- whether raw text was kept (access-gated) for these
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_redaction_events_tenant     ON call_redaction_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_redaction_events_transcript ON call_redaction_events (transcript_id);
