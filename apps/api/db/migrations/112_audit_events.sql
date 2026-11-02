-- 112_audit_events.sql — unified, append-only platform audit trail. Today only domain-specific logs exist
-- (technician_audit_logs, settings_audit_logs, owner_audit_log); this is the single canonical store that every
-- module can write to, and that the tenant audit view and the Super Admin Audit Logs screen (S22) read back.
-- Append-only by design: rows are inserted and read, never updated or deleted (lawful retention workflows excepted,
-- handled out of band). Tenant/branch scoped; cross-tenant reads are Super-Admin-only. Additive + idempotent.
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID,
  actor_role    TEXT,
  actor_name    TEXT,
  module        TEXT NOT NULL,           -- e.g. 'checkout', 'auth', 'super-admin', 'automation'
  action        TEXT NOT NULL,           -- e.g. 'payment.refunded', 'user.role_changed', 'login.failed'
  resource_type TEXT,
  resource_id   TEXT,
  summary       TEXT,                    -- human-readable description of the event
  status        TEXT NOT NULL DEFAULT 'success',   -- success | failed | warning
  severity      TEXT NOT NULL DEFAULT 'low',       -- low | medium | high | critical
  ip            TEXT,
  device        TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_occurred ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_module   ON audit_events (tenant_id, module);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_severity ON audit_events (tenant_id, severity);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_actor    ON audit_events (tenant_id, actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred        ON audit_events (occurred_at DESC);
