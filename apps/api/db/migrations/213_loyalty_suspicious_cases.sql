-- 177_loyalty_suspicious_cases.sql — a real store for suspicious-redemption review. Cases are DERIVED by documented
-- heuristics over actual loyalty_redemptions rows (velocity, high-value, rapid-repeat); each case references real
-- redemption sample ids. This is oversight tooling — it never mutates points, balances, tiers, or redemptions. Statuses:
-- open → reviewing → resolved | dismissed. Idempotent upsert by bucket_key so re-running detection updates, not duplicates.
CREATE TABLE IF NOT EXISTS loyalty_suspicious_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  customer_id  UUID,
  signal_type  TEXT NOT NULL,                    -- velocity | high_value | rapid_repeat
  severity     TEXT NOT NULL DEFAULT 'medium',   -- low | medium | high
  status       TEXT NOT NULL DEFAULT 'open',     -- open | reviewing | resolved | dismissed
  bucket_key   TEXT NOT NULL,                     -- natural idempotency key: tenant|customer|signal|daybucket
  detail_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by  UUID,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_susp_bucket ON loyalty_suspicious_cases (bucket_key);
CREATE INDEX IF NOT EXISTS ix_loyalty_susp_status ON loyalty_suspicious_cases (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS ix_loyalty_susp_tenant ON loyalty_suspicious_cases (tenant_id, status);
