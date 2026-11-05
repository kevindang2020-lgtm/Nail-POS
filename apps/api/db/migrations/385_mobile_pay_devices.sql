-- 385_mobile_pay_devices.sql — the per-install registry of iPhones authorized to take Tap to Pay for a tenant.
--
-- Spec §6: Tap to Pay may run ONLY on an approved, registered device. This table is that registry. The Manager Pay
-- app registers its stable per-install device id on sign-in (status 'pending'); an owner/Super Admin approves it
-- ('active'); a compromised or retired device is 'revoked'. Readiness (mobile-checkout-readiness) sources
-- `deviceApproved` from status = 'active' for THIS tenant (and branch, when the device is branch-bound) — so an
-- unregistered, pending, or revoked device can never take a payment. No device secret/token is stored here.
CREATE TABLE IF NOT EXISTS mobile_pay_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id          UUID,
  device_id          TEXT NOT NULL,          -- the app's stable per-install id (util/session.ts DEVICE_ID)
  label              TEXT,
  platform           TEXT NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'ipados', 'web', 'unknown')),
  os_version         TEXT,
  app_version        TEXT,
  tap_to_pay_capable BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  registered_by      UUID,
  approved_by        UUID,
  approved_at        TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_id)
);
CREATE INDEX IF NOT EXISTS ix_mobile_pay_devices_tenant_status ON mobile_pay_devices (tenant_id, status);
