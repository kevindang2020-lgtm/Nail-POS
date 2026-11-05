-- 298_voice_integration_keys.sql — auth store for the AI Voice Receptionist gateway (Phase 2).
-- Mirrors tenant_api_keys (134): the raw key is NEVER stored — only its sha-256 hash + a display prefix. Each key is
-- bound to a tenant AND a branch, because the voice gateway resolves tenant/branch FROM THE KEY (never from the caller
-- or the voice provider). One key per provider integration (e.g. a Retell agent). Rotate = new hash, same row; revoke =
-- set revoked_at. The partial index keeps active-key lookup fast and unique per prefix.

CREATE TABLE IF NOT EXISTS voice_integration_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID NOT NULL,                       -- voice calls resolve tenant+branch from the key
  label               TEXT NOT NULL,                       -- human label, e.g. 'Retell — Main St front desk'
  provider            TEXT NOT NULL DEFAULT 'retell',      -- which voice provider this key authenticates
  prefix              TEXT NOT NULL,                       -- e.g. 'vk_live_Ab12' — shown for identification only
  secret_hash         TEXT NOT NULL,                       -- sha-256 of the full raw key; the raw key is never stored
  last_used_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast active-key lookup by hash (verification path), scoped to non-revoked rows.
CREATE INDEX IF NOT EXISTS idx_voice_keys_secret_hash ON voice_integration_keys (secret_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_voice_keys_tenant ON voice_integration_keys (tenant_id) WHERE revoked_at IS NULL;
-- A given raw key hashes to exactly one row; enforce no duplicate active hash.
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_keys_active_hash ON voice_integration_keys (secret_hash) WHERE revoked_at IS NULL;
