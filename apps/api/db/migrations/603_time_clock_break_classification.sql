-- 603_time_clock_break_classification.sql — Fair Turn Engine mandate §31–40 (time clock + breaks), Oct 12 2026.
--
-- A QUEUE HOLD (technician_turn_state status HOLD) is not a payroll break; a TIME-CLOCK break has payroll meaning. The
-- break keeps its actual start / end (580) and now also its compensable treatment, decided by the salon's BREAK POLICY
-- (never hard-coded in queue code, §35):
--   time_clock_break_policies — one row per salon (branch_id NULL) or per branch (overrides), versioned. policy JSON:
--     { jurisdiction, restBreakPaidUpToMinutes, mealBreakMinMinutes, interruptedMealCompensable, kindDefaults }.
--     The documented default is the U.S. federal shape (short rest breaks compensable, a bona fide meal of 30+ minutes
--     with the employee relieved of duty non-compensable); a state can be more protective — the owner configures it.
--   technician_breaks + classification / paid_minutes / unpaid_minutes / policy_version (stamped when the break ends) and
--     interrupted_at / interrupted_by / interruption_reason (§36: BREAK_INTERRUPTED — a meal cut short is never recorded
--     as a full uninterrupted meal).
--   technician_timecard_adjustments + break_id — a manager's break correction goes through the SAME append-only trail as
--     a punch correction (original value, new value, reason, manager, time — §39).
-- EXPAND-ONLY, idempotent.

CREATE TABLE IF NOT EXISTS time_clock_break_policies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID,
  version     INTEGER NOT NULL DEFAULT 1,
  policy      JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_clock_break_policies_scope
  ON time_clock_break_policies (tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS classification TEXT;
ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS paid_minutes INTEGER;
ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS unpaid_minutes INTEGER;
ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS policy_version INTEGER;
ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS interrupted_at TIMESTAMPTZ;
ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS interrupted_by TEXT;
ALTER TABLE technician_breaks ADD COLUMN IF NOT EXISTS interruption_reason TEXT;
ALTER TABLE technician_breaks DROP CONSTRAINT IF EXISTS chk_technician_breaks_classification;
ALTER TABLE technician_breaks ADD CONSTRAINT chk_technician_breaks_classification
  CHECK (classification IS NULL OR classification IN ('paid_rest', 'unpaid_rest_excess', 'unpaid_meal', 'paid_meal_short', 'paid_meal_interrupted'));

ALTER TABLE technician_timecard_adjustments ADD COLUMN IF NOT EXISTS break_id UUID;
CREATE INDEX IF NOT EXISTS idx_timecard_adjustments_break ON technician_timecard_adjustments (tenant_id, break_id) WHERE break_id IS NOT NULL;
