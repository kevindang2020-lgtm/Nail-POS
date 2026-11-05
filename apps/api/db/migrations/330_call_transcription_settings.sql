-- 330_call_transcription_settings.sql — per-tenant transcription policy. One row per (tenant, branch-null default).
-- These override the env defaults at ingest: whether transcription is enabled, the retention window, whether raw
-- (pre-redaction) text is retained, and the current consent-announcement version. Redaction itself is NOT
-- configurable off — it always runs.
CREATE TABLE IF NOT EXISTS voice_transcription_settings (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL,
  branch_id                     UUID,
  transcription_enabled         BOOLEAN NOT NULL DEFAULT true,
  retention_days                INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 3650),
  retain_raw                    BOOLEAN NOT NULL DEFAULT false,
  consent_announcement_version  TEXT,
  updated_by                    TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_voice_transcription_settings_tenant ON voice_transcription_settings (tenant_id);
