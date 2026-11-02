-- MERGE: ported from Project B migration 042 (renumbered to avoid collision with Project A 042_*).
-- 042_notifications.sql — tenant-facing notification send log (SMS/email to customers). Metered against
-- sms_credits / email_credits in tenant_usage_limits. Application-level tenant scoping (no RLS in prod migrations).

CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  channel        TEXT NOT NULL CHECK (channel IN ('sms','email')),
  to_address     TEXT NOT NULL,
  subject        TEXT,
  body           TEXT NOT NULL,
  customer_id    UUID,
  status         TEXT NOT NULL CHECK (status IN ('sent','failed','blocked')),
  provider_id    TEXT,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created ON notifications (tenant_id, created_at DESC);
