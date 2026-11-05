-- 136_event_logs.sql — unified device + integration log store (spec §54-§55). One table, `category` distinguishes
-- 'device' vs 'integration'. Severity is constrained at the app layer. correlation_id ties related entries together;
-- related_id points at the device/integration/webhook the entry concerns. metadata is a small JSON blob and must
-- NEVER contain secrets or full sensitive payloads (the writers redact). branch_id NULL = tenant-wide.
CREATE TABLE IF NOT EXISTS tenant_event_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  category        TEXT NOT NULL,                  -- 'device' | 'integration'
  severity        TEXT NOT NULL DEFAULT 'info',   -- 'info' | 'warning' | 'error' | 'critical'
  source          TEXT NOT NULL,                  -- e.g. 'webhook', 'terminal', 'deployment'
  message         TEXT NOT NULL,
  correlation_id  TEXT,
  related_id      TEXT,
  status          TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_event_logs_tenant_cat ON tenant_event_logs (tenant_id, category, created_at DESC);
