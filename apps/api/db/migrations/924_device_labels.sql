-- 924_device_labels.sql — Device Health 06 (extras round 10): a salon's own alias and asset tag for any device in the fleet
-- (customer displays, kiosks, payment terminals, registers live in four registries — one labels table covers them all, keyed by
-- the registry and the device id). Searchable in Device Health; set / cleared by a manager, audited. Expand-only.
CREATE TABLE IF NOT EXISTS device_labels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants (id),
  device_source  TEXT NOT NULL CHECK (device_source IN ('station', 'kiosk', 'display', 'terminal')),
  device_id      TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 80),
  alias          TEXT CHECK (alias IS NULL OR length(btrim(alias)) BETWEEN 1 AND 60),
  asset_tag      TEXT CHECK (asset_tag IS NULL OR length(btrim(asset_tag)) BETWEEN 1 AND 40),
  updated_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_source, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_labels_asset_tag ON device_labels (tenant_id, lower(asset_tag)) WHERE asset_tag IS NOT NULL;
