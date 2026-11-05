-- 406_gift_card_clearing.sql — cross-tenant clearing & settlement data model (spec §15–17). Foundation only: these tables
-- record the inter-tenant obligation created when one salon redeems a card issued by ANOTHER salon in the same network
-- program, and the human-reviewed settlement batches that group those obligations. No money moves automatically —
-- settlement is approved by a person (super admin). Writing entries on cross-tenant redemption and the settlement/approval
-- surface come in later slices; this migration just lays the schema so those can build on a verified foundation.

-- Program redemption scope: default tenant-only; a program can opt in to owner-portfolio or the full AI PowerSalon network.
ALTER TABLE gift_card_programs ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'tenant_only'
  CHECK (scope IN ('tenant_only','owner_portfolio','network'));

-- Enrich the existing program membership table (gift_card_program_members, from 401) with an opt-in lifecycle so a tenant
-- can be active / suspended / left, and record when they joined. Uniqueness is the table's PK (program_id, tenant_id).
ALTER TABLE gift_card_program_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','suspended','left'));
ALTER TABLE gift_card_program_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_gift_card_program_members_tenant ON gift_card_program_members (tenant_id, status);

-- A settlement batch groups clearing entries for human review + approval before any funds move.
CREATE TABLE IF NOT EXISTS gift_card_settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES gift_card_programs(id),
  period_start DATE,
  period_end DATE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending_review','approved','settled','disputed','reversed','failed')),
  total_cents BIGINT NOT NULL DEFAULT 0,
  fee_cents BIGINT NOT NULL DEFAULT 0,
  net_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  approved_by_user_id UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One clearing entry per cross-tenant redemption: the issuing tenant (liability holder) owes the redeeming tenant the
-- redeemed amount (less any configured platform fee). Money is integer cents; a clearing entry only exists when the
-- issuing and redeeming tenants genuinely differ.
CREATE TABLE IF NOT EXISTS gift_card_clearing_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES gift_card_programs(id),
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  redemption_transaction_id UUID,                -- the gift_card_transactions redeem row that created this obligation
  issuing_tenant_id UUID NOT NULL,               -- owes (holds the stored-value liability)
  redeeming_tenant_id UUID NOT NULL,             -- is owed (performed the service / product sale)
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  platform_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','validated','ready','approved','settled','disputed','reversed','failed')),
  settlement_batch_id UUID REFERENCES gift_card_settlement_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gift_card_clearing_cross_tenant CHECK (issuing_tenant_id <> redeeming_tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_gift_card_clearing_issuer   ON gift_card_clearing_entries (issuing_tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_card_clearing_redeemer ON gift_card_clearing_entries (redeeming_tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_card_clearing_batch    ON gift_card_clearing_entries (settlement_batch_id);
-- One clearing obligation per redemption ledger row (idempotency for the future cross-tenant write path).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_clearing_redemption
  ON gift_card_clearing_entries (redemption_transaction_id) WHERE redemption_transaction_id IS NOT NULL;
