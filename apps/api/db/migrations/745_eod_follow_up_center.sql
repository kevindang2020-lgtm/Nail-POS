-- 745_eod_follow_up_center.sql — End-of-Day Follow-Ups Complete Build Guide (Oct 30 2026). Additive + one data repair.
--
-- 1. HISTORY IS NEVER ERASED (guide §10 "24-hour expiration semantics"). Until now the expiry sweep set deleted_at on
--    unsent tasks (so they vanished from every view and freed the (line, tech) unique index — the same service line
--    could be generated again) and a second job hard-DELETED them after 30 days. From now on expiry is a status
--    change that keeps the row (expired_at + skip_reason); the purge job is removed from the code. This migration
--    brings back the rows an earlier sweep hid — only where no live duplicate was generated for the same line since
--    (those stay hidden: un-hiding them would break the one-task-per-line rule). Rows already purged are gone; the
--    lifecycle audit_logs entries for them remain.
-- 2. 'rejected' — a manager can now refuse a draft (guide §5 "Manager approval", §9 status list). The technician may
--    edit and resubmit; it can also expire, be skipped or dismissed.
-- 3. Customer contact protection (guide §8): a per-branch cooldown — no second follow-up to the same customer inside
--    N hours (0 = off). Default 24 h so a client served by two technicians on one day is not messaged twice.
-- 4. Diagnostic run record (guide §6 "Evidence required"): candidates / excluded / per-reason counts, the rule
--    version, the timezone and generation time the run used, and the run key.
-- Rollback: the columns and the index are additive (DROP them); the status CHECK can be restored from 072 once no
-- 'rejected' rows exist; the un-hide in step 1 is reversible with UPDATE … SET deleted_at = expired_at WHERE status
-- = 'expired' (it would hide them again).

-- 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
UPDATE service_follow_up_tasks f
   SET expired_at = COALESCE(f.expired_at, f.deleted_at), deleted_at = NULL,
       skip_reason = COALESCE(f.skip_reason, 'expired_unsent'), updated_at = now()
 WHERE f.status = 'expired' AND f.deleted_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM service_follow_up_tasks d
                    WHERE d.tenant_id = f.tenant_id AND d.branch_id = f.branch_id AND d.ticket_service_line_id = f.ticket_service_line_id
                      AND d.technician_id = f.technician_id AND d.deleted_at IS NULL AND d.id <> f.id);

-- 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE service_follow_up_tasks DROP CONSTRAINT IF EXISTS service_follow_up_tasks_status_check;
ALTER TABLE service_follow_up_tasks DROP CONSTRAINT IF EXISTS service_follow_up_tasks_status_chk;
ALTER TABLE service_follow_up_tasks
  ADD CONSTRAINT service_follow_up_tasks_status_chk
  CHECK (status IN ('pending','pending_manager_approval','rejected','sent','skipped','dismissed','failed','customer_not_available','customer_replied','rebooked','expired'));
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS rejected_by_user_id UUID;
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS manager_note TEXT;
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS approved_by_user_id UUID;
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE daily_follow_up_settings ADD COLUMN IF NOT EXISTS contact_cooldown_hours INTEGER NOT NULL DEFAULT 24;
DO $$ BEGIN
  ALTER TABLE daily_follow_up_settings ADD CONSTRAINT ck_dfus_cooldown CHECK (contact_cooldown_hours BETWEEN 0 AND 720);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE service_follow_up_tasks ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- 4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS candidates_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS excluded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS exclusions_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS rule_version TEXT;
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS run_timezone TEXT;
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS generation_time TEXT;
ALTER TABLE daily_follow_up_generation_runs ADD COLUMN IF NOT EXISTS run_key TEXT;

-- Indexes for the history search (newest first), the expiry sweep (every unsent state) and the cooldown check.
CREATE INDEX IF NOT EXISTS ix_sfut_branch_created ON service_follow_up_tasks (tenant_id, branch_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_sfut_unsent_created ON service_follow_up_tasks (tenant_id, branch_id, created_at)
  WHERE status IN ('pending','pending_manager_approval','rejected') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sfut_customer_sent ON service_follow_up_tasks (tenant_id, customer_id, sent_at DESC) WHERE sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dfugr_branch_date ON daily_follow_up_generation_runs (tenant_id, branch_id, business_date DESC);
