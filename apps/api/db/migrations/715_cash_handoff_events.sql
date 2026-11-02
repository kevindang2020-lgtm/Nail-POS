-- 715_cash_handoff_events.sql — End-of-Day Cash mandate (Oct 29 2026). EXPAND-ONLY, idempotent; nothing is rewritten.
--
-- §15–§17 of the mandate: every count, partial hand-off, review and resolution is a DISTINCT, immutable custody event —
-- "do not overwrite the first with the second", "preserve the original figures and show any resolution through audited
-- adjustments". tech_cash_handoffs stays the one reconciliation unit per technician and business date (its status keeps
-- the TECH_CASH_HANDOFF lifecycle); this ledger keeps what happened to it, in order, with the actor and the idempotency
-- key of each submission, so a double tap or a retried request is one event and the dashboard is derived from facts.
CREATE TABLE IF NOT EXISTS tech_cash_handoff_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  branch_id          uuid,
  technician_id      uuid NOT NULL,
  business_date      date NOT NULL,
  handoff_id         uuid,                                   -- the tech_cash_handoffs row at the time (set once it exists)
  event_type         text NOT NULL CHECK (event_type IN ('submitted', 'counted', 'partial', 'recount', 'resolved', 'reopened', 'drawer_transfer')),
  amount_cents       bigint,                                 -- the amount this event carries (a count, a partial, a transfer)
  expected_cents     bigint,                                 -- the expected amount at that moment (the snapshot the actor saw)
  counted_total_cents bigint,                                -- the unit's accepted count after this event
  variance_cents     bigint,                                 -- counted_total − expected after this event
  denominations_json jsonb,                                  -- optional count sheet: [{"denominationCents":2000,"quantity":2}, …]
  reason             text,                                   -- variance reason / resolution reason / note
  actor_user_id      uuid,
  drawer_movement_id uuid,                                   -- the cash_drawer_movements row a transfer wrote (never a sale)
  idempotency_key    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tch_events_unit ON tech_cash_handoff_events (tenant_id, technician_id, business_date, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tch_events_idem ON tech_cash_handoff_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The unit carries its version (optimistic concurrency: two counters cannot both finalize — the second sees the first's
-- result), the last count sheet, and how a discrepancy was resolved (reason, approver, when) WITHOUT touching the original
-- expected / counted / variance figures.
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS denominations_json jsonb;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS resolution_reason text;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE tech_cash_handoffs ADD COLUMN IF NOT EXISTS drawer_transfer_cents bigint NOT NULL DEFAULT 0;   -- Σ live transfers into the drawer
CREATE INDEX IF NOT EXISTS idx_tech_cash_handoffs_tenant_created ON tech_cash_handoffs (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cash_payment_conf_tech_confirmed ON cash_payment_confirmations (tenant_id, technician_id, confirmed_at) WHERE status = 'confirmed';
