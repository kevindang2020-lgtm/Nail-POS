-- 329_call_transcription_deletion.sql — append-only audit of every transcript deletion (retention expiry, tenant
-- erasure request, or explicit delete). The transcript header is kept as a tombstone (status='deleted', deleted_at
-- set, text removed) so deletion is idempotent and auditable; segments/intelligence rows are removed and the
-- provider-side recording is deleted through the adapter. Legal-hold transcripts are never auto-deleted.
CREATE TABLE IF NOT EXISTS call_deletion_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  transcript_id      UUID,                                  -- kept even after the header is tombstoned
  provider           TEXT,
  provider_call_id   TEXT,
  reason             TEXT NOT NULL DEFAULT 'retention_expired'
                       CHECK (reason IN ('retention_expired','tenant_request','customer_request','manual','admin')),
  segments_deleted   INTEGER NOT NULL DEFAULT 0,
  provider_deleted   BOOLEAN NOT NULL DEFAULT false,
  actor              TEXT,                                  -- 'system' (sweep) or a user id
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_deletion_events_tenant     ON call_deletion_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_deletion_events_transcript ON call_deletion_events (transcript_id);
