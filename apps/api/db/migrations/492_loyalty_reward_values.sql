-- 492_loyalty_reward_values.sql — Functional Decision 15, loyalty step: a reward is worth something at checkout.
-- Before: a reward had only a title and a points cost; a customer who spent points got a code that checkout never asked
-- for, and codes had no state. Now a reward is a fixed amount off or a percent off (with an optional validity period),
-- and every issued code carries a SNAPSHOT of that value (editing a reward never changes codes already issued) and a
-- state: issued → applied (reserved to one ticket) → used (that ticket was paid); or void.
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS reward_type TEXT NOT NULL DEFAULT 'amount_off';
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS valid_days INTEGER;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE loyalty_rewards DROP CONSTRAINT IF EXISTS loyalty_rewards_value_check;
ALTER TABLE loyalty_rewards ADD CONSTRAINT loyalty_rewards_value_check CHECK (
  reward_type IN ('amount_off', 'percent_off') AND value_cents >= 0 AND percent BETWEEN 0 AND 100 AND (valid_days IS NULL OR valid_days > 0));

ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'issued';
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS reward_type TEXT;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS value_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS ticket_id UUID;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
ALTER TABLE loyalty_redemptions ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE loyalty_redemptions DROP CONSTRAINT IF EXISTS loyalty_redemptions_status_check;
ALTER TABLE loyalty_redemptions ADD CONSTRAINT loyalty_redemptions_status_check CHECK (
  status IN ('issued', 'applied', 'used', 'void') AND (status <> 'applied' OR ticket_id IS NOT NULL) AND value_cents >= 0 AND percent BETWEEN 0 AND 100);

-- Codes issued before this had no value; their snapshot copies whatever the reward has (0 for every reward that exists
-- today), so they cannot take anything off until... they never will: an issued code's value is fixed at issue.
UPDATE loyalty_redemptions d SET reward_type = r.reward_type, value_cents = r.value_cents, percent = r.percent
  FROM loyalty_rewards r WHERE d.reward_type IS NULL AND r.id = d.reward_id AND r.tenant_id = d.tenant_id;
UPDATE loyalty_redemptions SET reward_type = 'amount_off' WHERE reward_type IS NULL;

-- A code is looked up by its text at checkout, within one salon.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_redemptions_tenant_code ON loyalty_redemptions (tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_ticket ON loyalty_redemptions (tenant_id, ticket_id) WHERE ticket_id IS NOT NULL;
