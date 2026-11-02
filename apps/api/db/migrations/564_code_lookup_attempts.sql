-- 564_code_lookup_attempts.sql — BUILD_PLAN Phase 14 (Constitution 12: coupon / gift-card abuse controls).
--
-- Every lookup BY A SECRET CODE (a gift-card number or code, a coupon code, a reward code, a gift-claim token) is one row
-- here, so a caller guessing codes is limited across API replicas without Redis:
--   • per CALLER   (the signed-in user; else the authenticated device; else the client IP)
--   • per IP       (clientIp(req) — the trusted-proxy address, never a raw header)
--   • per TENANT   (the salon the lookup ran in; null for a lookup with no salon)
-- Weighted: a MISS (no such code) costs 1, a HIT (a real code) costs 0.1, so an ordinary front desk ringing up gift
-- cards never comes near the budget while a run of wrong guesses does (@aipowersalon/security code-lookup-limit.ts holds
-- the budgets and the load model). An attempt is admitted as 'pending' at full weight BEFORE the lookup runs (under an
-- advisory lock per key), then settled to hit / miss — so N concurrent guesses can never all slip under the budget.
--
-- Not salon data a salon reads back: abuse telemetry, like login throttling. No RLS (admission runs before any business
-- logic and keys on the caller, not on a salon's rows). Rows older than a day have no use — the central retention
-- executor deletes them (retention-policy.json: temporary, 1 day).
CREATE TABLE IF NOT EXISTS code_lookup_attempts (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('gift_card', 'coupon', 'reward_code', 'gift_claim')),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  caller_key  text NOT NULL CHECK (length(caller_key) BETWEEN 3 AND 200),
  ip          text CHECK (ip IS NULL OR length(ip) BETWEEN 2 AND 64),
  outcome     text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'hit', 'miss')),
  weight      numeric(6,2) NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 10),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_code_lookup_attempts_caller ON code_lookup_attempts (caller_key, created_at);
CREATE INDEX IF NOT EXISTS ix_code_lookup_attempts_ip ON code_lookup_attempts (ip, created_at) WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_code_lookup_attempts_tenant ON code_lookup_attempts (tenant_id, created_at) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_code_lookup_attempts_created ON code_lookup_attempts (created_at);
COMMENT ON TABLE code_lookup_attempts IS 'Weighted lookups by secret code (gift card / coupon / reward code / gift claim) per caller, IP and salon — the per-caller lookup limit (Phase 14, Constitution 12).';
