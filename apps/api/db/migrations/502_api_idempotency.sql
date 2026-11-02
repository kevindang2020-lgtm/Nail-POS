-- 502_api_idempotency.sql — Constitution 5 §61–66 (Step 3, Oct 4 2026): ONE store for Idempotency-Key on the API's
-- money and once-only routes, so a retried or double-tapped refund / void runs exactly once and the retry gets the SAME
-- answer. The per-domain keys (booking, deals, voice gateway, card charges …) stay: they guard their own writes; this
-- store guards the HTTP request as a whole and is what an app's retry relies on.
-- A key is scoped to the CALLER (salon + who), so one person's key never replays another person's response.
CREATE TABLE IF NOT EXISTS api_idempotency (
  scope            TEXT NOT NULL,                 -- '<tenant or ->:<actorType>:<userId>'
  idem_key         TEXT NOT NULL,
  tenant_id        UUID,                          -- NULL for platform callers; lets tenant deletion remove the rows
  method           TEXT NOT NULL,
  route            TEXT NOT NULL,                 -- the route TEMPLATE (…/payments/:paymentId/refund)
  request_hash     TEXT NOT NULL,                 -- sha256 of method + route + params + body: same key, different request → refused
  state            TEXT NOT NULL DEFAULT 'inflight' CHECK (state IN ('inflight', 'done')),
  response_status  INTEGER,
  response_body    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, idem_key)
);
CREATE INDEX IF NOT EXISTS api_idempotency_expires_idx ON api_idempotency (expires_at);
CREATE INDEX IF NOT EXISTS api_idempotency_tenant_idx ON api_idempotency (tenant_id) WHERE tenant_id IS NOT NULL;
