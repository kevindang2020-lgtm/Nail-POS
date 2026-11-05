-- 804_wallet_alert_levels.sql — C1 audit (Nov 4 2026), LoyaltyTokens §5.6: the low / critical token-balance warnings are
-- configurable per salon within platform limits. NULL = the platform default (global_rewards_program). A salon may only set
-- critical at or below low; the application also keeps both within 0 .. 1,000,000 cents.
ALTER TABLE tenant_token_wallets ADD COLUMN IF NOT EXISTS low_balance_cents_override      INTEGER CHECK (low_balance_cents_override IS NULL OR low_balance_cents_override BETWEEN 0 AND 1000000);
ALTER TABLE tenant_token_wallets ADD COLUMN IF NOT EXISTS critical_balance_cents_override INTEGER CHECK (critical_balance_cents_override IS NULL OR critical_balance_cents_override BETWEEN 0 AND 1000000);
ALTER TABLE tenant_token_wallets DROP CONSTRAINT IF EXISTS ck_tenant_token_wallets_alert_order;
ALTER TABLE tenant_token_wallets ADD CONSTRAINT ck_tenant_token_wallets_alert_order
  CHECK (low_balance_cents_override IS NULL OR critical_balance_cents_override IS NULL OR critical_balance_cents_override <= low_balance_cents_override);
