-- 197_subscription_lifecycle.sql — pause/cancel lifecycle fields on tenant_subscriptions. Cancellation preserves all
-- history (invoices, payment attempts, subscription_changes, audit are never deleted); these columns only record the
-- lifecycle dates. Additive + nullable.
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS pause_start   TIMESTAMPTZ;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS pause_end     TIMESTAMPTZ;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS cancel_at     TIMESTAMPTZ;
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;

-- Widen the status CHECK to include the pause/pending-cancellation lifecycle states.
ALTER TABLE tenant_subscriptions DROP CONSTRAINT IF EXISTS tenant_subscriptions_status_check;
ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_status_check
  CHECK (status IN ('active','trialing','past_due','expired','cancelled','paused','pending_cancellation'));
