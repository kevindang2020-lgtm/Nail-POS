-- 024_pos_project_status.sql — optional persistence for POS project-status "recheck" timestamps.
-- The service computes completion from code checks; this table only records when a module was last rechecked.
CREATE TABLE IF NOT EXISTS pos_project_status_checks (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  module_key    TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by    TEXT,
  UNIQUE (tenant_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_pps_checks_tenant ON pos_project_status_checks (tenant_id);
