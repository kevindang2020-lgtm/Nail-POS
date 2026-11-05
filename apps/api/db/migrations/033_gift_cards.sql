-- 033_gift_cards.sql — tenant-scoped gift cards with real balances + a redemption ledger.
-- Gift cards are tenant-wide (branch_id NULL) so a card sold at one branch is redeemable at any branch.
CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  code TEXT NOT NULL,
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','redeemed','void')),
  customer_id UUID,
  issued_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One code per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_tenant_code ON gift_cards (tenant_id, code);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  type TEXT NOT NULL CHECK (type IN ('issue','redeem','adjust','refund')),
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  ticket_id UUID,
  payment_id UUID,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_txns_card ON gift_card_transactions (tenant_id, gift_card_id, created_at);
