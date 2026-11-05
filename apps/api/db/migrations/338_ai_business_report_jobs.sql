-- 322_ai_business_report_jobs.sql — generated business reports for the AI Business Assistant (spec §36).
-- A job records the report lifecycle (queued → running → completed/failed). The result is stored INLINE as JSONB on
-- the row (never in Redis, per §36) and expires. Tenant-scoped; branch_id NULL = all authorized branches. These are
-- BOUNDED structured reports (a few tool calls); genuinely large CSV/PDF exports remain the domain of a separate
-- worker + object storage and are out of scope for this table.
CREATE TABLE IF NOT EXISTS ai_business_report_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  requested_by_user_id UUID NOT NULL,
  report_type        TEXT NOT NULL
    CHECK (report_type IN ('daily_brief','weekly_summary','monthly_review','branch_comparison')),
  preset             TEXT NOT NULL DEFAULT 'today',
  status             TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed')),
  content            JSONB,                        -- the structured report; populated only when completed
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS ai_business_report_jobs_tenant_idx ON ai_business_report_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_business_report_jobs_status_idx ON ai_business_report_jobs (status, created_at DESC);
