-- 039_payment_processor_types.sql
-- Widen the per-tenant processor whitelist so the gateway abstraction can resolve additional adapters
-- (Payment Gateway Isolation §11). The original inline CHECK (migration 022) only allowed fiserv/cardpointe/none;
-- Stripe (and, later, Square/Clover) are real PaymentProcessor implementations selected per tenant by the resolver.
-- Re-runnable: drops the old/new constraint names before adding.

ALTER TABLE tenant_payment_config DROP CONSTRAINT IF EXISTS tenant_payment_config_processor_check;
ALTER TABLE tenant_payment_config DROP CONSTRAINT IF EXISTS tenant_payment_config_processor_allowed;
ALTER TABLE tenant_payment_config ADD CONSTRAINT tenant_payment_config_processor_allowed
  CHECK (processor IN ('fiserv', 'cardpointe', 'stripe', 'square', 'clover', 'manual', 'none'));
