-- 687_payment_device_identity.sql — Secure Tap to Pay mandate §3–§9, §58, §70–§71 (Oct 23 2026): every payment phone gets a
-- cryptographic identity, explicit branch authorization and a single-use pairing path. Extends mobile_pay_devices (385 / 660)
-- — no second device table.
--
--  • public_key / key_alg / key_fingerprint: the phone's own P-256 public key (SPKI, base64). The private key never leaves
--    the phone. A fingerprint is UNIQUE across the platform: two "devices" presenting the same key are one copied phone.
--    Set once at registration; a different key for the same device id is refused (a replacement phone is a NEW device).
--  • attestation_status: an integrity signal (none / passed / failed) — never the only control.
--  • mobile_pay_device_branches: the branches a device may take payments in (effective = user ∩ device). No rows = the
--    device's own branch_id (or any branch when that is NULL), the rule before this migration.
--  • mobile_pay_device_nonces: a signed request is accepted ONCE (device, nonce); rows older than the signature window are
--    swept by the API.
--  • payment_device_pairings: a short-lived, single-use, tenant- + branch- + purpose-scoped pairing code (only its hash).
ALTER TABLE mobile_pay_devices
  ADD COLUMN IF NOT EXISTS public_key         TEXT,
  ADD COLUMN IF NOT EXISTS key_alg            TEXT,
  ADD COLUMN IF NOT EXISTS key_fingerprint    TEXT,
  ADD COLUMN IF NOT EXISTS key_registered_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attestation_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS paired_via         TEXT;
ALTER TABLE mobile_pay_devices DROP CONSTRAINT IF EXISTS chk_mobile_pay_devices_key_alg;
ALTER TABLE mobile_pay_devices ADD CONSTRAINT chk_mobile_pay_devices_key_alg CHECK (key_alg IS NULL OR key_alg IN ('ES256'));
ALTER TABLE mobile_pay_devices DROP CONSTRAINT IF EXISTS chk_mobile_pay_devices_attestation;
ALTER TABLE mobile_pay_devices ADD CONSTRAINT chk_mobile_pay_devices_attestation CHECK (attestation_status IN ('none', 'passed', 'failed'));
ALTER TABLE mobile_pay_devices DROP CONSTRAINT IF EXISTS chk_mobile_pay_devices_paired_via;
ALTER TABLE mobile_pay_devices ADD CONSTRAINT chk_mobile_pay_devices_paired_via CHECK (paired_via IS NULL OR paired_via IN ('pos_qr'));
CREATE UNIQUE INDEX IF NOT EXISTS ux_mobile_pay_devices_key_fingerprint ON mobile_pay_devices (key_fingerprint) WHERE key_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobile_pay_device_branches (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  branch_id  UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id, branch_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES mobile_pay_devices (tenant_id, device_id) ON DELETE CASCADE
);
DROP TRIGGER IF EXISTS trg_tc_mobile_pay_device_branches_branch ON mobile_pay_device_branches;
CREATE TRIGGER trg_tc_mobile_pay_device_branches_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON mobile_pay_device_branches
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');

CREATE TABLE IF NOT EXISTS mobile_pay_device_nonces (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id, nonce)
);
CREATE INDEX IF NOT EXISTS ix_mobile_pay_device_nonces_created ON mobile_pay_device_nonces (created_at);

CREATE TABLE IF NOT EXISTS payment_device_pairings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  purpose          TEXT NOT NULL DEFAULT 'tap_to_pay_device' CHECK (purpose IN ('tap_to_pay_device')),
  code_hash        TEXT NOT NULL UNIQUE,
  label            TEXT,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  used_by_user_id  UUID,
  used_device_id   TEXT,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS ix_payment_device_pairings_tenant ON payment_device_pairings (tenant_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_tc_payment_device_pairings_branch ON payment_device_pairings;
CREATE TRIGGER trg_tc_payment_device_pairings_branch BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON payment_device_pairings
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
