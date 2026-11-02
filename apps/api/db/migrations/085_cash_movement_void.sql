-- 085_cash_movement_void.sql — allow voiding a mistaken/duplicate cash movement (soft-delete; keeps the audit trail).
-- A voided movement no longer affects the expected drawer total but remains on record (who voided it, when).
ALTER TABLE cash_drawer_movements ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE cash_drawer_movements ADD COLUMN IF NOT EXISTS voided_by_user_id uuid;
