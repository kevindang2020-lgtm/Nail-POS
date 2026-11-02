-- 746_follow_up_queue.sql — Follow-Up Queue Complete Build Guide (Oct 30 2026). Indexes only; no table, no data change.
--
-- The Follow-Up Queue reads the same service_follow_up_tasks the End-of-Day center and the 8 PM job write (no second
-- queue). Two reads are new:
--   1. the operational queue order (guide §06): unsent tasks by due date → priority → completed time → id;
--   2. the Missed Call type (guide §07/§13): inbound missed calls per branch, newest first.
-- Rollback: DROP INDEX IF EXISTS ix_sfut_unsent_due; DROP INDEX IF EXISTS ix_call_intel_branch_time;

CREATE INDEX IF NOT EXISTS ix_sfut_unsent_due ON service_follow_up_tasks (tenant_id, branch_id, business_date, completed_at, id)
  WHERE status IN ('pending', 'pending_manager_approval', 'rejected') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_call_intel_branch_time ON call_intelligence_events (tenant_id, branch_id, started_at DESC);
