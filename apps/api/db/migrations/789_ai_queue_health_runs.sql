-- 789_ai_queue_health_runs.sql — A6 AI Queue guide §9 Upgrade 1 (Nov 4 2026): "Check AI Queue System" records each run
-- (per-component status, evidence, failure, fix) so the page can show the last check and when it ran. Read-only checks;
-- a run never assigns anyone. One location's queue = one branch.
CREATE TABLE IF NOT EXISTS ai_queue_health_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  overall     TEXT NOT NULL CHECK (overall IN ('READY','ATTENTION_REQUIRED','FAILED','DISABLED','NOT_CONFIGURED','UNKNOWN')),
  checks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_queue_health_runs_branch ON ai_queue_health_runs (tenant_id, branch_id, created_at DESC, id DESC);
-- B-12: the location must belong to the same salon (the trigger every tenant FK carries)
DROP TRIGGER IF EXISTS trg_tc_ai_queue_health_runs__branch_id ON ai_queue_health_runs;
CREATE TRIGGER trg_tc_ai_queue_health_runs__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON ai_queue_health_runs FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
