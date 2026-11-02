-- 307_reception_copilot_action_ledger.sql — idempotency ledger for Reception Copilot mutations (spec §28/§49). Each
-- confirmed action may carry an idempotency_key; the unique index guarantees a given (tenant, key) executes at most
-- once, so a double-click or client retry replays the recorded outcome instead of booking/cancelling twice. Stores
-- only the compact outcome (ok + resource id), never sensitive input.
CREATE TABLE IF NOT EXISTS reception_copilot_action_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  idempotency_key TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  ok              BOOLEAN NOT NULL,
  resource_id     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rcopilot_action_idem ON reception_copilot_action_ledger (tenant_id, idempotency_key);
