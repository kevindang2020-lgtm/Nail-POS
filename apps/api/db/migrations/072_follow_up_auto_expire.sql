-- 072_follow_up_auto_expire.sql — auto-remove stale unactioned follow-ups. Adds an 'expired' status and a per-branch
-- window (auto_expire_pending_hours, default 24, 0 = off). A scheduler sweep soft-deletes tasks that are still 'pending'
-- after the window (a tech never sent/skipped them), setting status='expired' + deleted_at=now() so they drop out of
-- every queue (which all filter deleted_at IS NULL) while staying auditable. Tasks the tech acted on are untouched.
-- Idempotent: the column add is guarded; the status CHECK is dropped (by both possible names) before being re-added.
ALTER TABLE daily_follow_up_settings ADD COLUMN IF NOT EXISTS auto_expire_pending_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE service_follow_up_tasks DROP CONSTRAINT IF EXISTS service_follow_up_tasks_status_check;
ALTER TABLE service_follow_up_tasks DROP CONSTRAINT IF EXISTS service_follow_up_tasks_status_chk;
ALTER TABLE service_follow_up_tasks
  ADD CONSTRAINT service_follow_up_tasks_status_chk
  CHECK (status IN ('pending','pending_manager_approval','sent','skipped','dismissed','failed','customer_not_available','customer_replied','rebooked','expired'));

-- Helps the sweep find stale pending rows quickly.
CREATE INDEX IF NOT EXISTS ix_sfut_pending_created ON service_follow_up_tasks (tenant_id, branch_id, created_at) WHERE status = 'pending' AND deleted_at IS NULL;
