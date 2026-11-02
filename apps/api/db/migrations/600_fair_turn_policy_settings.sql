-- 600_fair_turn_policy_settings.sql — Fair Turn Engine mandate (Oct 12 2026) §9–13, §18–19, §121–124, §164–166.
--
-- The turn policy goes INTO the ONE versioned settings source (queue_assignment_tenant_settings under per-branch
-- queue_assignment_settings rows, snapshots in queue_assignment_settings_versions) — no second settings table:
--   • assignment_mode    — AUTOMATIC | RECOMMEND_AND_CONFIRM | MANUAL (§9). New salons start RECOMMEND_AND_CONFIRM (§13);
--                          a salon that already had auto-assign switched on is backfilled AUTOMATIC (its behaviour is kept).
--   • turn_policy        — the rest of the house rules as one JSON object (join position, requested / appointment turn
--                          policy, protection buffer, break position policy, decline / timeout consequence, half-turn
--                          behaviour, carry-over, start-of-day order, visibility, …). The salon row holds the salon's values
--                          ({} = the documented Recommended Nail Salon Default); a branch row's keys override the salon's
--                          (NULL = inherit everything). Validated in code (modules/workforce turn-queue/turn-core.ts).
--   • rotation_policy    — the fairness mode. The five mandate modes join the five legacy policies (kept: a salon that
--                          picked one keeps it). The column default becomes traditional_weighted_rotation (§50), and salons
--                          that never chose a rotation (no 'rotation' version row) move to it.
-- pos_tech_appointments.any_technician — §19: a booking made for "first available" (no technician chosen) is an
--   any-technician appointment; NULL = unknown (rows before this migration) and is treated as a requested appointment.
-- EXPAND-ONLY, idempotent.

ALTER TABLE queue_assignment_tenant_settings ADD COLUMN IF NOT EXISTS assignment_mode TEXT NOT NULL DEFAULT 'RECOMMEND_AND_CONFIRM';
ALTER TABLE queue_assignment_tenant_settings ADD COLUMN IF NOT EXISTS turn_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE queue_assignment_tenant_settings DROP CONSTRAINT IF EXISTS chk_qa_tenant_assignment_mode;
ALTER TABLE queue_assignment_tenant_settings ADD CONSTRAINT chk_qa_tenant_assignment_mode
  CHECK (assignment_mode IN ('AUTOMATIC', 'RECOMMEND_AND_CONFIRM', 'MANUAL'));
UPDATE queue_assignment_tenant_settings SET assignment_mode = 'AUTOMATIC' WHERE auto_enabled AND assignment_mode <> 'AUTOMATIC';

ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS assignment_mode TEXT;
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS turn_policy JSONB;
ALTER TABLE queue_assignment_settings DROP CONSTRAINT IF EXISTS chk_qa_branch_assignment_mode;
ALTER TABLE queue_assignment_settings ADD CONSTRAINT chk_qa_branch_assignment_mode
  CHECK (assignment_mode IS NULL OR assignment_mode IN ('AUTOMATIC', 'RECOMMEND_AND_CONFIRM', 'MANUAL'));
UPDATE queue_assignment_settings SET assignment_mode = 'AUTOMATIC' WHERE auto_enabled IS TRUE AND assignment_mode IS NULL;

ALTER TABLE queue_assignment_tenant_settings DROP CONSTRAINT IF EXISTS queue_assignment_tenant_settings_rotation_policy_check;
ALTER TABLE queue_assignment_tenant_settings ADD CONSTRAINT queue_assignment_tenant_settings_rotation_policy_check
  CHECK (rotation_policy IN ('traditional_weighted_rotation', 'lowest_turn_units', 'workload_balanced', 'hybrid_fairness', 'manual_order',
                             'hybrid', 'least_minutes', 'least_customers', 'first_available', 'fixed_order'));
ALTER TABLE queue_assignment_tenant_settings ALTER COLUMN rotation_policy SET DEFAULT 'traditional_weighted_rotation';
UPDATE queue_assignment_tenant_settings s SET rotation_policy = 'traditional_weighted_rotation'
 WHERE s.rotation_policy = 'hybrid'
   AND NOT EXISTS (SELECT 1 FROM queue_assignment_settings_versions v WHERE v.tenant_id = s.tenant_id AND v.change = 'rotation');

ALTER TABLE queue_assignment_rotation_state DROP CONSTRAINT IF EXISTS queue_assignment_rotation_state_policy_check;
ALTER TABLE queue_assignment_rotation_state ADD CONSTRAINT queue_assignment_rotation_state_policy_check
  CHECK (policy IS NULL OR policy IN ('traditional_weighted_rotation', 'lowest_turn_units', 'workload_balanced', 'hybrid_fairness', 'manual_order',
                                      'hybrid', 'least_minutes', 'least_customers', 'first_available', 'fixed_order'));

ALTER TABLE pos_tech_appointments ADD COLUMN IF NOT EXISTS any_technician BOOLEAN;
