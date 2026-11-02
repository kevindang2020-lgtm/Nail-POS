-- 758_ai_calendar_center.sql — AI Calendar Complete Build Guide (Oct 2026).
-- Additive only. Rollback: DROP TABLE ai_calendar_health_runs; DROP INDEX ix_pta_tenant_created; DROP INDEX
-- ix_pta_tenant_source_date. No existing row is read or rewritten.
--
-- 1. Check Calendar System runs are recorded (evidence + a 30-second rate limit per salon). A run never changes booking
--    data; it only records what it observed.
-- 2. Two read indexes for the AI Calendar's List view: newest-created first (the default sort) and the AI-created
--    source filter. Both are on the canonical appointments table — AI Calendar never keeps a copy of appointments.

CREATE TABLE IF NOT EXISTS ai_calendar_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  calendar_date DATE,
  overall       TEXT NOT NULL CHECK (overall IN ('READY', 'WARNING', 'FAILED', 'NOT_CONFIGURED', 'DISABLED', 'UNKNOWN')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_calendar_health_recent ON ai_calendar_health_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_pta_tenant_created ON pos_tech_appointments (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_pta_tenant_source_date ON pos_tech_appointments (tenant_id, source, appt_date);
