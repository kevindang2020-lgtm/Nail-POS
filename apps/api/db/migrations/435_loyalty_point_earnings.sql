-- 435: Constitution 8 §25/§102 — a business-uniqueness ledger for loyalty points earned on payments.
-- Today the balance on customer_loyalty_profiles is a mutable counter with no record of WHICH payment earned
-- what; skip-line's awardLoyaltyForPayment can be called twice and will award twice. An event consumer must be
-- exactly-once on the BUSINESS effect even when delivery is at-least-once or a replay happens — processed_events
-- guards delivery, this table guards the effect: one earning row per (tenant, payment), enforced by the database.
CREATE TABLE IF NOT EXISTS loyalty_point_earnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  customer_id   UUID NOT NULL,
  payment_id    UUID NOT NULL,
  ticket_id     UUID,
  amount_cents  INTEGER NOT NULL,
  points        INTEGER NOT NULL CHECK (points >= 0),
  source        TEXT NOT NULL DEFAULT 'payment.captured',     -- which fact earned it
  event_id      UUID,                                         -- the domain event that produced it (traceability, §145)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payment_id)                              -- THE guard: a payment earns points at most once, ever
);
CREATE INDEX IF NOT EXISTS idx_loyalty_earnings_customer ON loyalty_point_earnings (tenant_id, customer_id, created_at DESC);
