-- 088_alerts.sql
-- Super-Admin Alerts: actionable items (read / resolved / dismissed) materialized from real platform signals,
-- distinct from audit_logs (immutable history). dedupe_key keeps signal-driven sync idempotent.

CREATE TABLE IF NOT EXISTS alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name          TEXT,
  title                TEXT NOT NULL,
  message              TEXT NOT NULL DEFAULT '',
  type                 TEXT NOT NULL DEFAULT 'system'
                         CHECK (type IN ('tenant','payment','hardware','support','application','security','system','billing','ai_package','usage_limit')),
  severity             TEXT NOT NULL DEFAULT 'low'  CHECK (severity IN ('low','medium','high','critical')),
  status               TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','resolved','dismissed')),
  related_module       TEXT,
  related_record_id    TEXT,
  assigned_to_user_id  UUID REFERENCES users(id),
  dedupe_key           TEXT NOT NULL UNIQUE,
  read_at              TIMESTAMPTZ,
  resolved_at          TIMESTAMPTZ,
  dismissed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_created ON alerts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant ON alerts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts (severity);

CREATE TABLE IF NOT EXISTS alert_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id       UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES users(id),
  note           TEXT NOT NULL,
  is_internal    BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_notes_alert ON alert_notes (alert_id, created_at DESC);
