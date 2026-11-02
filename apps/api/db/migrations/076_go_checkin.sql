-- 076_go_checkin.sql
-- AIPowerSalon Go Check-In: a customer-facing kiosk/browser self check-in that connects to the correct tenant POS.
-- SECURITY: tenant_id + branch_id are resolved on the SERVER from a hashed device token / check-in slug — never from
-- the client. Raw tokens are never stored (only their sha256 hash), mirroring the customer-display device model.
-- Reuses existing customers / pos_tech_appointments / check-in records / queue for the actual check-in work.

-- ------------------------------------------------------------------------------------------------------------------
-- A physical kiosk device, bound to exactly one tenant (and optionally one branch). The public_url embeds the slug;
-- the device authenticates with a token whose hash is stored here. One slug per device.
CREATE TABLE IF NOT EXISTS go_checkin_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,                                   -- null = tenant-wide device
  device_name        TEXT NOT NULL,
  device_type        TEXT NOT NULL DEFAULT 'kiosk' CHECK (device_type IN ('kiosk','ipad','l_shape_display','tablet','front_desk')),
  checkin_slug       TEXT NOT NULL,                          -- opaque, URL-safe; the public route is /go-check-in/:slug
  public_url         TEXT,                                   -- convenience copy of the full URL (informational)
  device_token_hash  TEXT,                                   -- sha256 hex of the device token; NULL until first issued
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','disabled','revoked')),
  last_seen_at       TIMESTAMPTZ,                            -- last heartbeat
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_go_checkin_devices_slug ON go_checkin_devices (checkin_slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_go_checkin_devices_token ON go_checkin_devices (device_token_hash) WHERE device_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_go_checkin_devices_tenant ON go_checkin_devices (tenant_id);

-- ------------------------------------------------------------------------------------------------------------------
-- A short-lived check-in session opened when a customer lands on the kiosk. Carries the SERVER-resolved tenant/branch
-- so every subsequent action is scoped without the client ever sending a tenantId. Token hash only.
CREATE TABLE IF NOT EXISTS go_checkin_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  device_id          UUID NOT NULL REFERENCES go_checkin_devices(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,                          -- sha256 hex of the per-session token
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','completed','expired','revoked','failed')),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  expired_at         TIMESTAMPTZ,
  metadata_json      JSONB NOT NULL DEFAULT '{}'::jsonb       -- safe metadata only (e.g. lookup attempt counts); never raw PII
);
CREATE INDEX IF NOT EXISTS idx_go_checkin_sessions_device ON go_checkin_sessions (device_id);
CREATE INDEX IF NOT EXISTS idx_go_checkin_sessions_tenant ON go_checkin_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_go_checkin_sessions_active ON go_checkin_sessions (status) WHERE status = 'active';

-- ------------------------------------------------------------------------------------------------------------------
-- A safe, append-only audit trail surfaced in Super Admin. safe_message + metadata_json must never contain full
-- sensitive customer details (no full phone/email/notes) — only what's needed to follow a check-in.
CREATE TABLE IF NOT EXISTS go_checkin_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  device_id     UUID,
  session_id    UUID,
  event_type    TEXT NOT NULL,                               -- e.g. session_started, phone_entered, tenant_customer_found, ...
  safe_message  TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_go_checkin_logs_tenant ON go_checkin_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_go_checkin_logs_device ON go_checkin_logs (device_id, created_at DESC);

-- ------------------------------------------------------------------------------------------------------------------
-- Per-tenant Go Check-In configuration (master enable + per-feature toggles). One row per tenant; Super Admin owns the
-- master switch, the tenant can tune feature toggles within it.
CREATE TABLE IF NOT EXISTS tenant_checkin_settings (
  tenant_id                  UUID PRIMARY KEY,
  enabled                    BOOLEAN NOT NULL DEFAULT false,  -- master switch (Super Admin)
  appointment_checkin_enabled BOOLEAN NOT NULL DEFAULT true,
  walkin_checkin_enabled     BOOLEAN NOT NULL DEFAULT true,
  new_customer_enabled       BOOLEAN NOT NULL DEFAULT true,
  service_selection_enabled  BOOLEAN NOT NULL DEFAULT true,
  technician_preference_enabled BOOLEAN NOT NULL DEFAULT true,
  tenant_phone_lookup_enabled BOOLEAN NOT NULL DEFAULT true,
  central_lookup_enabled     BOOLEAN NOT NULL DEFAULT true,
  customer_linking_enabled   BOOLEAN NOT NULL DEFAULT true,
  show_wait_estimate         BOOLEAN NOT NULL DEFAULT true,
  auto_send_to_queue         BOOLEAN NOT NULL DEFAULT true,
  require_front_desk_approval BOOLEAN NOT NULL DEFAULT false,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
