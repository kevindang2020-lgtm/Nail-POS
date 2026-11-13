-- 922_rewards_idempotency_events.sql — GLOBAL LOYALTY REWARDS 11 (extras round 10): Idempotency conflict center.
-- Every time a rewards request arrives with a key that was ALREADY used, the existing idempotency check records it here:
-- 'replay' (same request again — answered with the first result, no second side effect) or 'conflict' (the key reused for a
-- DIFFERENT request — refused). Append-only evidence for Super Admin review; nothing here changes a purchase or a redemption.
CREATE TABLE IF NOT EXISTS rewards_idempotency_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id),
  scope         TEXT NOT NULL CHECK (scope IN ('token_purchase', 'redemption')),
  outcome       TEXT NOT NULL CHECK (outcome IN ('replay', 'conflict')),
  request_key   TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  resource_id   UUID,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_rie_time ON rewards_idempotency_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_rie_tenant_key ON rewards_idempotency_events (tenant_id, scope, request_key);
CREATE OR REPLACE FUNCTION rewards_idempotency_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'rewards_idempotency_events is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_rie_append_only ON rewards_idempotency_events;
CREATE TRIGGER trg_rie_append_only BEFORE UPDATE OR DELETE ON rewards_idempotency_events FOR EACH ROW EXECUTE FUNCTION rewards_idempotency_events_append_only();
