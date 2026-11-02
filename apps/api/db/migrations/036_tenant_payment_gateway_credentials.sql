-- 036_tenant_payment_gateway_credentials.sql
-- Per-tenant payment gateway ISOLATION (Payment Gateway Isolation spec §7/§8/§9/§12).
--
-- tenant_payment_config (created in 022) already holds the per-tenant processor + live MID + status, but had no place
-- for the tenant's own gateway CREDENTIALS — so the only credentials available were the global CARDPOINTE_* env vars,
-- which every tenant shared. That is the "shared gateway" this spec forbids. These additive columns let each tenant
-- store its OWN gateway credentials, encrypted at rest (AES-256-GCM, same cipher as mfa_factors.secret_enc).
--
-- Idempotent (IF NOT EXISTS); independent of other tables; safe to apply in any order.

ALTER TABLE tenant_payment_config
  ADD COLUMN IF NOT EXISTS environment        TEXT NOT NULL DEFAULT 'sandbox'
                             CHECK (environment IN ('sandbox', 'production')),
  ADD COLUMN IF NOT EXISTS base_url           TEXT,                 -- per-tenant gateway endpoint (e.g. CardPointe site URL)
  ADD COLUMN IF NOT EXISTS api_username_enc   TEXT,                 -- encrypted; NULL until provisioned
  ADD COLUMN IF NOT EXISTS api_password_enc   TEXT,                 -- encrypted; NULL until provisioned
  ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT,                 -- encrypted; NULL until provisioned
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID;

-- Note: merchant_id (the MID) stays in its existing column; it is masked on read (maskSecret) and is not a secret
-- credential, but it is never returned in full to the POS/frontend. Raw card data is never stored anywhere.
