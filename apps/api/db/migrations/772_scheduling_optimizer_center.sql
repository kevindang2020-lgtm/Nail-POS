-- 772_scheduling_optimizer_center.sql — AI Scheduling Optimizer guide (Nov 2 2026). Additive only.
-- Rollback: DROP TABLE scheduling_optimizer_health_runs; DROP INDEX ix_sched_decisions_history, ix_sched_recs_history.
--
-- The optimizer's tables stay as built (migrations 345 / 528). This adds only what the page's read side needs:
--   • indexes for the newest-first queue and the History trail (stable tie on id);
--   • scheduling_optimizer_health_runs — the read-only "Check Scheduling System" run's evidence.
CREATE INDEX IF NOT EXISTS ix_sched_recs_history ON schedule_optimization_recommendations (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_sched_decisions_history ON schedule_recommendation_decisions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduling_optimizer_health_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  branch_id     UUID,
  actor_user_id UUID,
  overall       TEXT NOT NULL CHECK (overall IN ('PASSED', 'WARNING', 'FAILED', 'INSUFFICIENT_DATA')),
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sched_health_recent ON scheduling_optimizer_health_runs (tenant_id, created_at DESC);
