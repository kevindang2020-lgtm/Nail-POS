-- 363_community_fingerprint_retention.sql — additive: retention for privacy-safe risk fingerprints.
-- The spec requires that risk signals "expire old risk signals according to retention policy" — a fingerprint
-- that lives forever is a permanent shadow record, which is exactly what this feature must not create. Every
-- fingerprint therefore carries an explicit expiry, and lookups must exclude expired rows.
ALTER TABLE community_risk_fingerprints
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '180 days');

-- False-positive correction: a fingerprint reported as wrong is retired, never silently kept.
ALTER TABLE community_risk_fingerprints
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE community_risk_fingerprints
  ADD COLUMN IF NOT EXISTS retired_reason TEXT;

CREATE INDEX IF NOT EXISTS ix_fingerprint_active
  ON community_risk_fingerprints (indicator_kind, fingerprint)
  WHERE retired_at IS NULL;
