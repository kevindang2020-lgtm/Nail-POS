-- 186_device_management.sql
-- Device Management greenfield support tables. Existing device sources (pos_payment_terminals, customer_display_devices,
-- go_checkin_devices, device_sessions, hardware_package_devices) remain the source of truth for inventory + connectivity;
-- these tables add the pieces with no home yet: the hardware catalog, hardware shipments, maintenance records, and
-- device security alerts. All are tenant/branch scoped. No device secret/token is ever stored here.
CREATE TABLE IF NOT EXISTS device_catalog (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type    TEXT NOT NULL,                 -- reception_pos | check_in_kiosk | payment_terminal | printer | caller_id | owner_mobile | technician_mobile | customer_display
  display_name   TEXT NOT NULL,
  model_count    INTEGER NOT NULL DEFAULT 0,
  availability   TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','limited','retired')),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (model_count >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_catalog_type ON device_catalog (device_type);

CREATE TABLE IF NOT EXISTS device_shipments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_reference TEXT NOT NULL,
  tenant_id          UUID,
  destination_branch TEXT,
  device_label       TEXT,
  device_type        TEXT,
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','preparing','packed','shipped','in_transit','out_for_delivery','delivered','delayed','lost','returned','cancelled')),
  carrier            TEXT,
  tracking_masked    TEXT,                       -- masked tracking number only
  eta_at             TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_shipment_ref ON device_shipments (shipment_reference);
CREATE INDEX IF NOT EXISTS ix_device_shipment_status ON device_shipments (status);

CREATE TABLE IF NOT EXISTS device_maintenance (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_reference   TEXT NOT NULL,
  device_id          UUID,
  device_label       TEXT,
  tenant_id          UUID,
  branch_name        TEXT,
  reason             TEXT,
  status             TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','maintenance','delayed','completed','cancelled')),
  started_at         TIMESTAMPTZ,
  expected_return_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_device_maint_ref ON device_maintenance (ticket_reference);

CREATE TABLE IF NOT EXISTS device_security_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    UUID,
  device_label TEXT,
  tenant_id    UUID,
  tenant_name  TEXT,
  issue        TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low','informational')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','suppressed','monitoring')),
  last_action  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_device_sec_alert_tenant ON device_security_alerts (tenant_id);
CREATE INDEX IF NOT EXISTS ix_device_sec_alert_severity ON device_security_alerts (severity);
