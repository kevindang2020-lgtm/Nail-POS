-- 447_backup_reports.sql — Constitution 11 §114–117: backup and restore-drill visibility.
--
-- The platform cannot observe a managed database provider's backups from inside the API. What it CAN do is receive a
-- report from the backup job (POST /internal/backups/report, shared-secret protected) and notice when reports stop.
-- One row per report; small by construction (a few rows a day).
CREATE TABLE IF NOT EXISTS backup_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           TEXT NOT NULL CHECK (kind IN ('backup','restore_drill')),
  status         TEXT NOT NULL CHECK (status IN ('success','failure')),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ NOT NULL,
  size_bytes     BIGINT,
  pitr_enabled   BOOLEAN,                 -- §114 PITR status, as reported
  integrity_ok   BOOLEAN,                 -- §116 restore drills only
  smoke_test_ok  BOOLEAN,                 -- §116 restore drills only
  detail         TEXT,                    -- free text from the job; never secrets or hostnames (the job's contract)
  reported_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_backup_reports_kind_completed ON backup_reports (kind, completed_at DESC);
