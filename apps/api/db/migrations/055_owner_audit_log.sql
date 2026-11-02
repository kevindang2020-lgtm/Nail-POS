-- 055_owner_audit_log.sql — append-only audit trail of Owner-app actions (alert acknowledge/resolve/dismiss, report
-- exports, …). Mirrors the existing settings_audit_logs shape. Read back via GET /owner/audit. Never updated or deleted.
CREATE TABLE IF NOT EXISTS owner_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID,
  user_id     UUID,
  role        TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_audit_tenant_created ON owner_audit_log (tenant_id, created_at DESC);
