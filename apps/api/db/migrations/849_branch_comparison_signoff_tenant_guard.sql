-- 849_branch_comparison_signoff_tenant_guard.sql — B-12 for the round-7 snapshot sign-offs (migration 848).
--
-- ai_branch_comparison_signoffs.snapshot_id → ai_branch_comparison_snapshots is a tenant→tenant foreign key, so like every
-- other one it gets the enforce_tenant_consistency trigger: a sign-off can never point at another salon's snapshot, even if
-- application code passed a crossed id (tenant-consistency.pgtest B-12 checks every such FK has the trigger).
-- Idempotent; expand-only (adds a trigger, changes no data).
DROP TRIGGER IF EXISTS tc_ai_branch_comparison_signoffs_snapshot ON ai_branch_comparison_signoffs;
CREATE TRIGGER tc_ai_branch_comparison_signoffs_snapshot BEFORE INSERT OR UPDATE OF snapshot_id, tenant_id ON ai_branch_comparison_signoffs
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('ai_branch_comparison_snapshots', 'snapshot_id');
