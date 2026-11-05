-- 329_bank_webhook_endpoints.sql — per-tenant bank webhook endpoints. The tenant (and target bank account) is
-- resolved from the endpoint TOKEN in the URL — a verified credential — NEVER from the webhook payload. The
-- signing_secret verifies an HMAC signature (stripe-style t=,v1= header) which also carries a timestamp for
-- replay protection. Deposit idempotency is enforced by the existing bank_deposits external-txn unique index.
CREATE TABLE IF NOT EXISTS bank_webhook_endpoints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  bank_account_id   UUID NOT NULL,
  token             TEXT NOT NULL UNIQUE,     -- opaque URL token; identifies tenant + account
  signing_secret    TEXT NOT NULL,            -- HMAC secret (store via secret manager in production)
  status            TEXT NOT NULL DEFAULT 'active',  -- active | disabled
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bank_webhook_endpoints_tenant ON bank_webhook_endpoints (tenant_id);
