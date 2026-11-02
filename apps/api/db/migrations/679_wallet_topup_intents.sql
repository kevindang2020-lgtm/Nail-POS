-- 679_wallet_topup_intents.sql — Remaining-work mandate §P1-1 / B-79 (Oct 23 2026): a customer wallet top-up is a durable
-- INTENT before the card is charged, so a lost or unknown processor answer can be settled later from the processor's own
-- record (inquireByOrderid with the intent id as the order id) — exactly like a POS card attempt. Before this, the charge
-- used an idempotency key containing Date.now(): a retry was a brand-new charge, and an unknown answer had no owner.
--   status   CREATED → PROCESSING → APPROVED | DECLINED | FAILED (host could not process it — nothing charged) | UNKNOWN
--            (answer lost / not settled — the sweep and Verify ask the processor) | CANCELED. Only PROCESSING / UNKNOWN
--            may be settled, and a conditional UPDATE picks exactly ONE settler under a race.
--   client_key   the app's key for this tap (one per intent per customer): a retry with the same key returns the same
--                intent and never charges again.
--   attempt      counts the processor calls made for this intent (the processor idempotency key is 'topup:<id>:<attempt>');
--                the order id sent to the processor is always the intent id.
-- The wallet credit itself stays in customer_wallet_ledger with idempotency_key 'topup:<id>' — its unique index is what
-- makes "credited exactly once" true whoever settles the intent (client retry, sweep, staff Verify).
-- EXPAND-ONLY, idempotent; integer cents; tenant-scoped.
CREATE TABLE IF NOT EXISTS wallet_topup_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  payment_method_id UUID,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PROCESSING','APPROVED','DECLINED','UNKNOWN','FAILED','CANCELED')),
  client_key TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  processor TEXT,
  processor_transaction_id TEXT,
  resp_text TEXT,
  failure_reason TEXT,
  settled_by TEXT,                       -- 'charge' | 'verify' | 'sweep' | 'webhook' — who moved it out of PROCESSING/UNKNOWN
  last_inquired_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_by_user_id UUID,
  updated_by UUID,                       -- the user who last moved it (a staff Verify); NULL = the customer's own tap or the system sweep
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_intents_customer ON wallet_topup_intents (tenant_id, customer_id, created_at DESC);
-- the sweep's population: intents still PROCESSING / UNKNOWN, oldest first
CREATE INDEX IF NOT EXISTS idx_wallet_topup_intents_open ON wallet_topup_intents (created_at) WHERE status IN ('PROCESSING','UNKNOWN');
-- one intent per client key per customer: the retry of a tap finds its intent instead of charging again
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topup_intents_client_key ON wallet_topup_intents (tenant_id, customer_id, client_key) WHERE client_key IS NOT NULL;
-- the customer must belong to the same salon (migration 450's consistency rule, as on payment_intents)
DROP TRIGGER IF EXISTS trg_tc_wallet_topup_customer ON wallet_topup_intents;
CREATE TRIGGER trg_tc_wallet_topup_customer BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON wallet_topup_intents FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('customers', 'customer_id');
