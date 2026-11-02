-- 122_inventory_alerts.sql — Stock-threshold alert dispatch (§17).
-- When a product's on-hand crosses into a worse tier (low / critical / out_of_stock), the inventory service
-- records an alert here. Alerts are deduped (one open alert per product/status), superseded on escalation,
-- and auto-resolved when stock recovers. Managers see open + acknowledged alerts and can acknowledge them.
-- Additive only. This is an in-app staff alert feed — distinct from the customer SMS/email notifications log.

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  product_id UUID NOT NULL,
  status TEXT NOT NULL,                       -- low | critical | out_of_stock
  on_hand INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id UUID,
  resolved_at TIMESTAMPTZ                      -- set automatically when stock recovers, or on supersede
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON inventory_alerts (tenant_id, branch_id, resolved_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_product ON inventory_alerts (tenant_id, product_id, resolved_at);
