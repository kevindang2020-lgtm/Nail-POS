-- 437_cash_drawer_registers.sql
-- Add support for multiple simultaneous cash drawers per branch per day.
-- We drop the old unique constraint and add a new one that includes register_id.

ALTER TABLE cash_drawer_sessions ADD COLUMN IF NOT EXISTS register_id text NOT NULL DEFAULT 'main';

ALTER TABLE cash_drawer_sessions DROP CONSTRAINT IF EXISTS cash_drawer_sessions_tenant_id_branch_id_business_date_key;

-- Add new unique constraint
ALTER TABLE cash_drawer_sessions ADD CONSTRAINT cash_drawer_sessions_tenant_branch_register_date_key UNIQUE (tenant_id, branch_id, register_id, business_date);

-- Update the index
DROP INDEX IF EXISTS idx_cash_drawer_tenant_branch_date;
CREATE INDEX IF NOT EXISTS idx_cash_drawer_tenant_branch_register_date ON cash_drawer_sessions (tenant_id, branch_id, register_id, business_date);

ALTER TABLE cash_drawer_movements ADD COLUMN IF NOT EXISTS register_id text NOT NULL DEFAULT 'main';
CREATE INDEX IF NOT EXISTS idx_cash_drawer_movements_tenant_branch_register_date ON cash_drawer_movements (tenant_id, branch_id, register_id, business_date);
