-- 481_technician_manager_messages.sql — the developer's "message my manager" feature (Tech App → managers) wrote to a
-- table no migration created (found by check:sql). Columns follow its three statements exactly.
CREATE TABLE IF NOT EXISTS technician_manager_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_id    UUID NOT NULL,
  technician_name  TEXT NOT NULL DEFAULT '',
  topic            TEXT NOT NULL DEFAULT '',
  message          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','resolved')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_tech_manager_messages_tenant ON technician_manager_messages (tenant_id, status, created_at DESC);
