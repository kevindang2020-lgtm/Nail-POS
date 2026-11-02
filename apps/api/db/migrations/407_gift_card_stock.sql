-- 407_gift_card_stock.sql — physical gift-card inventory (spec §21). A salon registers batches of pre-printed physical
-- cards (by their printed 16-digit number, stored only as a hash + last four — never in the clear, mirroring the digital
-- hardening) into stock. Each card is 'available' until it's sold ('activated', linked to its gift_cards row) or 'void'
-- (damaged/removed from the rack). Activation-at-sale wiring is a separate step; this is the stock registry.
CREATE TABLE IF NOT EXISTS gift_card_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID,
  card_number_hash TEXT NOT NULL,
  card_number_last4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','activated','void')),
  batch_label TEXT,
  gift_card_id UUID REFERENCES gift_cards(id),   -- set when a stock card is activated (sold)
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);
-- A physical card number is registered once per tenant (the hash is unique within the tenant).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_stock_number ON gift_card_stock (tenant_id, card_number_hash);
CREATE INDEX IF NOT EXISTS idx_gift_card_stock_tenant_status ON gift_card_stock (tenant_id, status);
