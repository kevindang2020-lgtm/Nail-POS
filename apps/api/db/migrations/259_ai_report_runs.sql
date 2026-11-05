-- 179_ai_report_runs.sql — the real report-run foundation (previously only a `report_exports` log existed). A run is an
-- immutable historical snapshot: it captures the scope, date range, data cutoff, and a STRUCTURED metrics snapshot built
-- server-side from the existing daily-summary tables. Generation is idempotent via UNIQUE (idempotency_key): a retry
-- resumes/returns the existing run rather than creating a second one. Numbers come only from validated calculations.
CREATE TABLE IF NOT EXISTS ai_report_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_reference   TEXT NOT NULL,
  report_key         TEXT NOT NULL,
  tenant_id          UUID,                                  -- NULL = platform-wide scope
  branch_id          UUID,
  scope_type         TEXT NOT NULL DEFAULT 'platform'
                       CHECK (scope_type IN ('platform','all_tenants','tenant','branch')),
  scope_snapshot     JSONB NOT NULL DEFAULT '{}'::jsonb,
  date_range_start   DATE NOT NULL,
  date_range_end     DATE NOT NULL,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  data_cutoff_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  generation_source  TEXT NOT NULL DEFAULT 'on_demand' CHECK (generation_source IN ('on_demand','scheduled')),
  generation_status  TEXT NOT NULL DEFAULT 'requested'
                       CHECK (generation_status IN ('requested','collecting','completed','partial','failed','cancelled')),
  metrics_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,    -- validated structured metrics; never AI-invented
  requested_by       UUID,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  duration_ms        INTEGER,
  failure_category   TEXT,
  failure_message    TEXT,
  parent_run_id      UUID REFERENCES ai_report_runs (id) ON DELETE SET NULL,
  idempotency_key    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_report_runs_idem UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_report_runs_key ON ai_report_runs (report_key, generation_status);
CREATE INDEX IF NOT EXISTS idx_ai_report_runs_tenant ON ai_report_runs (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_report_runs_created ON ai_report_runs (created_at);
