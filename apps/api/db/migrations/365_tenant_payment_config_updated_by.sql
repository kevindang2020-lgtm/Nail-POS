-- 365_tenant_payment_config_updated_by.sql
--
-- BUG FIX. `super-admin-merchant-accounts.kysely.repository.ts` writes `updated_by_user_id` on every merchant
-- account change:
--
--   assignMid()              → update tenant_payment_config set merchant_id = …, updated_by_user_id = …
--   updateProcessingStatus() → update tenant_payment_config set status = …, updated_by_user_id = …
--
-- …but the column was never created. Both methods are explicitly NON-SWALLOWING, so they do not fail quietly —
-- they THROW. Which means Super Admin could not assign a tenant's merchant ID, nor change their payment
-- processing status, at all: both operations error out against a real Postgres.
--
-- The column is plainly intended (the code passes an actor id, and the audit trail expects it), so add it rather
-- than strip the writes. Nullable — historic rows have no known actor.
ALTER TABLE tenant_payment_config
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID;
