-- 638_payment_merchant_accounts_and_terminal_registry.sql — Payments / Clover / Fiserv / Twilio mandate (Oct 13 2026, wave 3)
-- §7 / §10 / §13 (branch merchant hierarchy + the ONE provider router), §11–12 / §50 / §52 (terminal registry), §45 (webhook
-- inbox attempts), §168–169 (configuration version).
--
--   payment_merchant_accounts — a BRANCH's own merchant account. The tenant default stays where it always was
--     (tenant_payment_config, one row per tenant); a multi-location salon whose Cherry Hill branch settles to a different
--     MID gets one row here for that branch. PaymentGatewayResolver.resolve(tenant, branch) is the only reader that builds
--     a processor: the branch's row when it has one, else the tenant default — never another tenant's, never a global one.
--     Credentials follow the tenant default's rules exactly: AES-256-GCM sealed (*_enc, PAYMENT_SECRETS), never selected
--     back to a client, decrypted only inside the resolver. UNIQUE (tenant_id, branch_id): one merchant per branch.
--   pos_payment_terminals — the terminal registry gains what §11 / §50 name: provider, terminal type, serial number,
--     connection type, the merchant account it charges through, an explicit DISABLED state (disabled_at/by — a terminal is
--     never deleted so its payment history keeps its device), last seen / last ping / last transaction. The normalized
--     ONLINE / OFFLINE / BUSY / PROCESSING / DEGRADED / DISABLED / UNKNOWN status is DERIVED from these + the lease table
--     (payments-integration-core.ts terminalOperationalStatus) — there is no second status column to drift.
--   payment_gateway_events — the webhook inbox gains processing_attempts + last_error (a delivery whose business processing
--     failed is visible and counted, §45 / §158).
--   tenant_payment_config.config_version — bumped by every configuration write (§168), part of the router's cache key (§169).
--
-- EXPAND-ONLY and idempotent (IF NOT EXISTS everywhere); every new column is nullable or has a constant default (no table
-- rewrite on PG ≥ 11). Small tables — the indexes are plain; on a production database with a large payment_gateway_events
-- table build idx_pge_tenant_failed with CREATE INDEX CONCURRENTLY first (this file then finds it present).
CREATE TABLE IF NOT EXISTS payment_merchant_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id             UUID NOT NULL,
  processor             TEXT NOT NULL CHECK (processor IN ('fiserv', 'cardpointe', 'clover')),
  environment           TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  display_name          TEXT,
  merchant_id           TEXT,                       -- the MID (masked on every read; not a secret, never returned whole)
  currency              TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  base_url              TEXT,
  api_username_enc      TEXT,                       -- sealed; NULL until provisioned
  api_password_enc      TEXT,                       -- sealed (Clover: the ecommerce private token)
  webhook_secret_enc    TEXT,                       -- sealed
  bolt_base_url         TEXT,                       -- CardPointe Integrated Terminal (Bolt) — drives the Clover Compact
  bolt_api_key_enc      TEXT,                       -- sealed
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'disabled', 'error')),
  config_version        INT NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  last_validated_at     TIMESTAMPTZ,
  last_validation_error TEXT,
  created_by            UUID,
  updated_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_merchant_accounts_branch UNIQUE (tenant_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_merchant_accounts_mid ON payment_merchant_accounts (merchant_id) WHERE merchant_id IS NOT NULL;

ALTER TABLE tenant_payment_config ADD COLUMN IF NOT EXISTS config_version INT NOT NULL DEFAULT 1;

ALTER TABLE pos_payment_terminals
  ADD COLUMN IF NOT EXISTS provider            TEXT,          -- 'cardpointe_bolt' (Clover Compact on Bolt) | 'clover' | …
  ADD COLUMN IF NOT EXISTS terminal_type       TEXT,          -- 'clover_compact' | 'clover_flex' | 'clover_mini' | 'other'
  ADD COLUMN IF NOT EXISTS serial_number       TEXT,
  ADD COLUMN IF NOT EXISTS connection_type     TEXT,          -- 'cloud' (Bolt) | 'lan' | 'usb'
  ADD COLUMN IF NOT EXISTS merchant_account_id UUID,          -- NULL = the tenant default merchant
  ADD COLUMN IF NOT EXISTS disabled_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_by         UUID,
  ADD COLUMN IF NOT EXISTS disabled_reason     TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at        TIMESTAMPTZ,   -- last time the terminal answered (ping or transaction)
  ADD COLUMN IF NOT EXISTS last_ping_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ping_ok        BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_transaction_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by          UUID;

ALTER TABLE payment_gateway_events
  ADD COLUMN IF NOT EXISTS processing_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error          TEXT;
CREATE INDEX IF NOT EXISTS idx_pge_tenant_failed ON payment_gateway_events (tenant_id, created_at) WHERE last_error IS NOT NULL;

-- §140 / §5: a branch merchant row can only name a branch of its own tenant (the database refuses a cross-tenant pair).
DROP TRIGGER IF EXISTS trg_tc_merchant_account_branch ON payment_merchant_accounts;
CREATE TRIGGER trg_tc_merchant_account_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON payment_merchant_accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
