-- 079_hardware_card_volume.sql — per-tenant per-month card volume (the input to monthly reconciliation). Residual
-- imports (Fiserv) land here; the monthly job reads from here. Integer cents.
CREATE TABLE IF NOT EXISTS hardware_card_volume (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  billing_month TEXT NOT NULL,                 -- 'YYYY-MM'
  card_volume_cents BIGINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',       -- 'fiserv_residual' | 'manual' | ...
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, billing_month)
);
CREATE INDEX IF NOT EXISTS idx_hw_card_volume_tenant ON hardware_card_volume(tenant_id);
