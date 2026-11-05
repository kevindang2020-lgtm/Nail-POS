-- 334_queue_assignment_repair.sql — append-only audit of safe queue repairs. Repairs NEVER delete records or change
-- payments; they record the correction an authorized user chose for a stuck record (the actual state change runs
-- through the existing queue actions). History is preserved for every repair.
CREATE TABLE IF NOT EXISTS queue_repair_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID NOT NULL,
  queue_entry_id TEXT NOT NULL,
  alert_id       UUID REFERENCES queue_alerts(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  reason         TEXT,
  performed_by   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qrepair_tenant ON queue_repair_actions (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qrepair_entry  ON queue_repair_actions (tenant_id, queue_entry_id);
