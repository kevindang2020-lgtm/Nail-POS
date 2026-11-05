-- 527_ai_queue_assignment_ops.sql — BUILD_PLAN Phase 6 (ai_queue_assignment → complete), the ops half (agent C).
--
-- 1. Branch settings really INHERIT. Migration 524 made the new branch columns nullable ("null = the salon's value"),
--    but the four wait thresholds and the three auto columns from migrations 333/335 stayed NOT NULL with defaults. So
--    the first time a manager saved ANY value on a location (say "stuck after 25 min"), the row was created with
--    10/20/30/45 and auto OFF, and from then on that location ignored the salon's thresholds and auto switch. Now they
--    are nullable with no default. Existing rows: a value equal to the old column default was never a choice anyone
--    made (it is what an INSERT filled in) — it becomes "inherit", which is the same value today (the salon defaults
--    are the same numbers). auto_enabled is left as it is: on a location that someone switched auto on or off, that
--    stays their decision, and auto-assignment is opt-in.
-- 2. queue_alerts.notified_severity — the owner alert + manager push go out once per alert (and again only if it
--    escalates), never every minute the scan sees the same long wait.
-- 3. Indexes the per-minute background scan and the analytics use.

ALTER TABLE queue_assignment_settings ALTER COLUMN wait_approaching_min DROP NOT NULL, ALTER COLUMN wait_approaching_min DROP DEFAULT;
ALTER TABLE queue_assignment_settings ALTER COLUMN wait_exceeded_min DROP NOT NULL, ALTER COLUMN wait_exceeded_min DROP DEFAULT;
ALTER TABLE queue_assignment_settings ALTER COLUMN wait_severe_min DROP NOT NULL, ALTER COLUMN wait_severe_min DROP DEFAULT;
ALTER TABLE queue_assignment_settings ALTER COLUMN wait_critical_min DROP NOT NULL, ALTER COLUMN wait_critical_min DROP DEFAULT;
ALTER TABLE queue_assignment_settings ALTER COLUMN auto_enabled DROP NOT NULL, ALTER COLUMN auto_enabled DROP DEFAULT;
ALTER TABLE queue_assignment_settings ALTER COLUMN auto_confidence_floor DROP NOT NULL, ALTER COLUMN auto_confidence_floor DROP DEFAULT;
ALTER TABLE queue_assignment_settings ALTER COLUMN auto_max_per_run DROP NOT NULL, ALTER COLUMN auto_max_per_run DROP DEFAULT;

UPDATE queue_assignment_settings SET wait_approaching_min = NULL WHERE wait_approaching_min = 10;
UPDATE queue_assignment_settings SET wait_exceeded_min = NULL WHERE wait_exceeded_min = 20;
UPDATE queue_assignment_settings SET wait_severe_min = NULL WHERE wait_severe_min = 30;
UPDATE queue_assignment_settings SET wait_critical_min = NULL WHERE wait_critical_min = 45;
UPDATE queue_assignment_settings SET auto_confidence_floor = NULL WHERE auto_confidence_floor = 0.75;
UPDATE queue_assignment_settings SET auto_max_per_run = NULL WHERE auto_max_per_run = 5;

-- Same for the branch rotation row: a location that sets only its fixed turn order used to be written with policy
-- 'hybrid', overriding the salon's policy. A null policy now means "the salon's policy" (the CHECK accepts null).
ALTER TABLE queue_assignment_rotation_state ALTER COLUMN policy DROP NOT NULL, ALTER COLUMN policy DROP DEFAULT;   -- a row written only to stamp
-- who was served last (the queue's rotation bookkeeping) must not pin the location to 'hybrid' either

ALTER TABLE queue_alerts ADD COLUMN IF NOT EXISTS notified_severity TEXT;

-- the scan reads every unresolved alert of one branch to auto-resolve the ones whose condition cleared
CREATE INDEX IF NOT EXISTS idx_qalerts_branch_unresolved ON queue_alerts (tenant_id, branch_id) WHERE status <> 'resolved';
-- analytics / exports read decisions and alerts by branch and time
CREATE INDEX IF NOT EXISTS idx_qad_branch_created ON queue_assignment_decisions (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qalerts_branch_created ON queue_alerts (tenant_id, branch_id, created_at DESC);
