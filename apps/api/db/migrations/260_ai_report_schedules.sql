-- 180_ai_report_schedules.sql — recurring report schedules. Executing an occurrence produces exactly one ai_report_run:
-- the run's idempotency key is derived from (schedule_id + occurrence timestamp), so a worker retry or a duplicate tick
-- reconciles to the same run rather than generating a second report. Pause/resume preserve execution history.
CREATE TABLE IF NOT EXISTS ai_report_schedules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  report_key         TEXT NOT NULL,
  frequency          TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','quarterly','yearly')),
  run_at_time        TEXT NOT NULL DEFAULT '06:00',        -- HH:MM in the schedule timezone
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  scope_type         TEXT NOT NULL DEFAULT 'platform' CHECK (scope_type IN ('platform','all_tenants','tenant','branch')),
  tenant_id          UUID,
  branch_id          UUID,
  start_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at             TIMESTAMPTZ,
  next_run_at        TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','disabled','completed','archived')),
  owner              TEXT NOT NULL DEFAULT 'System',
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_report_schedules_status ON ai_report_schedules (status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_ai_report_schedules_key ON ai_report_schedules (report_key);
