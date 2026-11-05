-- 333_queue_assignment_alerts.sql — detection alerts + tenant/branch settings (wait thresholds). Thresholds are
-- NEVER hard-coded globally; this table is the tenant-configurable source. One active alert per (entry, type) is
-- enforced by a partial unique index so re-scanning is idempotent (updates the open alert rather than duplicating).
CREATE TABLE IF NOT EXISTS queue_assignment_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  wait_approaching_min INTEGER NOT NULL DEFAULT 10 CHECK (wait_approaching_min >= 0),
  wait_exceeded_min    INTEGER NOT NULL DEFAULT 20 CHECK (wait_exceeded_min >= 0),
  wait_severe_min      INTEGER NOT NULL DEFAULT 30 CHECK (wait_severe_min >= 0),
  wait_critical_min    INTEGER NOT NULL DEFAULT 45 CHECK (wait_critical_min >= 0),
  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS queue_alerts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID NOT NULL,
  queue_entry_id     TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('waiting_too_long','unassigned','congestion','stuck_record')),
  severity           TEXT NOT NULL CHECK (severity IN ('info','warning','high','critical')),
  reason             TEXT NOT NULL,
  age_minutes        INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by    TEXT,
  acknowledged_at    TIMESTAMPTZ,
  resolved_by        TEXT,
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qalerts_tenant_status ON queue_alerts (tenant_id, branch_id, status, created_at DESC);
-- one active (non-resolved) alert per entry+type → re-scans update, never duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uq_qalerts_active ON queue_alerts (tenant_id, branch_id, queue_entry_id, type) WHERE status <> 'resolved';
