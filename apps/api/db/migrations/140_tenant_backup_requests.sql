-- 135_tenant_backup_requests.sql — real, audited backup-request jobs (Account → Backup & Data Health, §32).
-- "Run Backup Now" records a genuine request row here (status 'requested'); an export worker advances it to
-- processing → completed/failed. The Account panel reflects the TRUE state — a fresh request honestly shows
-- "Queued", never a fabricated "Successful". Tenant-scoped; a tenant only ever sees/creates its own.
CREATE TABLE IF NOT EXISTS tenant_backup_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  requested_by_user_id  TEXT,
  status                TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','processing','completed','failed')),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  size_bytes            BIGINT,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_backup_requests_tenant ON tenant_backup_requests (tenant_id, requested_at DESC);
