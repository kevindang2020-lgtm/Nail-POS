-- 844_receipt_printers.sql — batch 8 decision 2 (Nov 9 2026): the salon's receipt-printer REGISTRY.
--
-- Until now Receipt Devices honestly said NOT CONFIGURED: there was no record of any printer. This table records each
-- printer a salon owns (where it is, how it connects, paper width) so the page can list, assign and retire them. It does
-- NOT print: there is still no print bridge on the devices, so a registered printer's connection is "not verified" and
-- the POS never claims a printer is online. Digital receipts stay in customer_display_sessions (unchanged).
CREATE TABLE IF NOT EXISTS receipt_printers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  branch_id        UUID REFERENCES branches(id),
  pos_station_id   UUID REFERENCES pos_stations(id),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  connection       TEXT NOT NULL CHECK (connection IN ('network', 'usb', 'bluetooth', 'cloud')),
  address          TEXT CHECK (address IS NULL OR length(address) <= 120),   -- IP / host / model note — never a secret
  paper_width_mm   INTEGER NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'retired')),
  retired_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_receipt_printers_tenant ON receipt_printers (tenant_id, branch_id, created_at DESC);
