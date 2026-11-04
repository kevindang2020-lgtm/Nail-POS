-- 795_loyalty_reward_rules.sql — Loyalty guide (Nov 4 2026): a reward's availability rules, checked at redemption time inside the
-- redemption transaction. All nullable: an existing reward keeps today's behaviour (no dates, no stock cap, no limit, every tier).
--   starts_on / ends_on   the salon-local days the reward can be redeemed (an upcoming or expired reward is not redeemable)
--   stock_total           how many may ever be redeemed (non-void redemptions count); NULL = unlimited
--   per_member_limit      how many one member may hold or have used (non-void); NULL = unlimited
--   eligible_tiers        the member tiers that may redeem it; NULL = every tier
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS ends_on date;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS stock_total integer;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS per_member_limit integer;
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS eligible_tiers text[];
DO $$ BEGIN
  ALTER TABLE loyalty_rewards ADD CONSTRAINT loyalty_rewards_rules_chk CHECK (
    (stock_total IS NULL OR stock_total >= 0) AND (per_member_limit IS NULL OR per_member_limit >= 1)
    AND (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
