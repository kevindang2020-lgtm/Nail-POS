-- 846_cash_handoff_reopen.sql — End-of-Day Cash 17 (Kevin, Nov 12 2026: "closed cash records CAN be reopened").
--
-- A technician's cash unit is CLOSED once it is reconciled (counted exactly, or a manager resolved the difference). From now
-- on a closed unit cannot be counted again directly: a person with the dedicated permission cash_handoff.reopen (owner /
-- manager) reopens it with a reason. The reopen keeps every figure (expected / counted / variance stay on the unit, and the
-- 'reopened' event in tech_cash_handoff_events records them as they were); the unit shows who reopened it, when and why; the
-- next count recomputes the expected cash from the source payments and closes it again. Money stays integer cents.
--
-- EXPAND-ONLY, idempotent: four nullable / defaulted columns and the status vocabulary gains 'reopened' (the Phase 10 helper
-- adds the widened CHECK NOT VALID and validates it — it only widens, so no existing row can fail).
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS reopened_by_user_id uuid;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS reopen_reason text;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;
ALTER TABLE tech_cash_handoffs DROP CONSTRAINT IF EXISTS tech_cash_handoffs_status_check;
DO $$
BEGIN
  PERFORM schema_apply_check('tech_cash_handoffs', 'tech_cash_handoffs_status_check',
    'status IN (''open'', ''submitted'', ''reconciled'', ''discrepancy'', ''cancelled'', ''reopened'')',
    '846_cash_handoff_reopen.sql');
END $$;
