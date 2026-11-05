-- 301_voice_gateway_idempotency.sql — idempotency ledger for the AI-receptionist Booking Gateway (Phase 1 §20).
-- Retell retries tool calls on timeouts; without this, a retried book/reschedule/cancel could execute twice.
-- Boundary: (tenant_id, operation, idempotency_key). Semantics: first request inserts a 'pending' row (the unique
-- index makes the insert the concurrency gate), commits with the stored response; a retry with the SAME payload hash
-- replays the stored response; a retry with a DIFFERENT payload is an idempotency conflict; a failed request releases
-- its pending row so a clean retry can proceed. Mirrors the idempotent-upsert pattern used elsewhere in the repo.

CREATE TABLE IF NOT EXISTS voice_gateway_idempotency (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID NOT NULL,
  operation        TEXT NOT NULL,               -- e.g. 'book' | 'reschedule' | 'cancel' | 'customer' | 'handoff'
  idempotency_key  TEXT NOT NULL,               -- the Retell function-call id (Idempotency-Key header)
  request_hash     TEXT NOT NULL,               -- sha256 of the canonicalized payload
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | committed
  response         JSONB,                       -- the committed response (replayed verbatim)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_gw_idem ON voice_gateway_idempotency (tenant_id, operation, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_voice_gw_idem_created ON voice_gateway_idempotency (created_at);
