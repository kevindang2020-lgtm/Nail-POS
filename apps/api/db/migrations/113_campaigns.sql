-- 113_campaigns.sql — marketing campaigns (Campaign Center, T15 / S10). Outbound SMS/email/push sends with an audience,
-- a lifecycle (draft → scheduled → in_progress → completed, cancellable), and engagement/revenue counters that the
-- screen derives open/click/reply rates + ROI from. Distinct from customer_deals (045), which are checkout-time
-- discounts. Tenant/branch scoped; all money in integer cents. Additive + idempotent.
CREATE TABLE IF NOT EXISTS campaigns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  name           TEXT NOT NULL,
  offer          TEXT,
  channel        TEXT NOT NULL DEFAULT 'sms',      -- sms | email | push
  audience_label TEXT,
  audience_size  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft',     -- draft | scheduled | in_progress | completed | cancelled
  scheduled_at   TIMESTAMPTZ,
  sent_count     INTEGER NOT NULL DEFAULT 0,
  open_count     INTEGER NOT NULL DEFAULT 0,
  click_count    INTEGER NOT NULL DEFAULT 0,
  reply_count    INTEGER NOT NULL DEFAULT 0,
  booking_count  INTEGER NOT NULL DEFAULT 0,
  revenue_cents  BIGINT NOT NULL DEFAULT 0,
  cost_cents     BIGINT NOT NULL DEFAULT 0,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status  ON campaigns (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_created ON campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_channel ON campaigns (tenant_id, channel);
