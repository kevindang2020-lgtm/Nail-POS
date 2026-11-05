-- 095_hardware_packages_enrichment.sql — upgrade the existing hardware_packages table (060) to the rich Super-Admin
-- Hardware Packages surface: package name/type, a package-level payment_status summary (the financial ledger stays in the
-- hardware_payment_* subsystem — not duplicated here), cost/deposit/paid, shipping address, carrier/tracking, and the full
-- lifecycle timestamps. Plus child tables for device serials and internal notes. Additive only; legacy rows + the basic
-- /platform/hardware endpoints keep working.

ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS package_name        TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS package_type        TEXT;     -- pro_plus / pro / standard / ...
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS payment_status      TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS hardware_cost_cents BIGINT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS deposit_cents       BIGINT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS amount_paid_cents   BIGINT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS financing_terms     TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS shipping_address    TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS shipping_city       TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS shipping_state      TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS shipping_zip        TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS shipping_carrier    TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS tracking_number     TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS tracking_url        TEXT;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS ordered_at          TIMESTAMPTZ;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS shipped_at          TIMESTAMPTZ;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS installed_at        TIMESTAMPTZ;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS returned_at         TIMESTAMPTZ;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS created_by_user_id  UUID;
ALTER TABLE hardware_packages ADD COLUMN IF NOT EXISTS updated_by_user_id  UUID;

-- Broaden status to the canonical set, keeping legacy values valid for existing rows.
ALTER TABLE hardware_packages DROP CONSTRAINT IF EXISTS hardware_packages_status_check;
ALTER TABLE hardware_packages ADD CONSTRAINT hardware_packages_status_check CHECK (status IN (
  'not_ordered','ready_to_ship','ordered','processing','shipped','delivered','installed','complete','cancelled','returned',
  'not_started','pending_approval','ready','activated','on_hold'
));
ALTER TABLE hardware_packages DROP CONSTRAINT IF EXISTS hardware_packages_payment_status_check;
ALTER TABLE hardware_packages ADD CONSTRAINT hardware_packages_payment_status_check CHECK (payment_status IN (
  'unpaid','pending','deposit_paid','financing','partially_paid','paid','paid_off','refunded'
));

CREATE INDEX IF NOT EXISTS idx_hardware_packages_payment   ON hardware_packages (payment_status);
CREATE INDEX IF NOT EXISTS idx_hardware_packages_carrier   ON hardware_packages (shipping_carrier);
CREATE INDEX IF NOT EXISTS idx_hardware_packages_tenant    ON hardware_packages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_hardware_packages_type      ON hardware_packages (package_type);

CREATE TABLE IF NOT EXISTS hardware_package_devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_package_id UUID NOT NULL REFERENCES hardware_packages(id) ON DELETE CASCADE,
  tenant_id           UUID,
  device_type         TEXT NOT NULL,            -- imac / clover_flex / checkin_display / printer / ...
  device_name         TEXT NOT NULL,
  serial_number       TEXT,
  asset_tag           TEXT,
  quantity            INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'assigned',
  warranty_start_at   TIMESTAMPTZ,
  warranty_end_at     TIMESTAMPTZ,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hardware_package_devices_pkg ON hardware_package_devices (hardware_package_id);
-- Guard against duplicate serials (partial: only when a serial is present).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hardware_device_serial ON hardware_package_devices (serial_number) WHERE serial_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS hardware_package_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_package_id UUID NOT NULL REFERENCES hardware_packages(id) ON DELETE CASCADE,
  actor_user_id       UUID,
  note                TEXT NOT NULL,
  is_internal         BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hardware_package_notes_pkg ON hardware_package_notes (hardware_package_id, created_at DESC);
