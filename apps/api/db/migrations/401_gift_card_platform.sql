-- 401_gift_card_platform.sql — Digital Gift Card platform, Phase 1 (additive foundation).
--
-- EXTENDS the canonical stored-value model from 033_gift_cards.sql (gift_cards + gift_card_transactions)
-- rather than replacing it. All changes are additive: new columns default safely, new tables are independent,
-- and the existing CHECK constraints are widened to supersets so every existing row stays valid. No data is moved.
-- Money is integer cents everywhere. Every table carries tenant_id for isolation. No btree_gist (plain unique
-- indexes for hold/token uniqueness) so the standard PGlite migration harness can verify it.

-- ── 1. Extend the gift-card ACCOUNT: purchased vs promotional value, richer lifecycle, program/design/recipient ──
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS purchased_cents INTEGER NOT NULL DEFAULT 0;   -- cash-backed value
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS promo_cents     INTEGER NOT NULL DEFAULT 0;   -- bonus (marketing expense)
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ;                  -- null = no expiry
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS program_id      UUID;                         -- multi-salon program (opt-in)
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS design_id       UUID;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS recipient_id    UUID;                         -- intended redeemer
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS reference       TEXT;                         -- masked display ref (not the code)
-- Non-negativity for the value split (balance_cents already guarded in code; assert the new columns here).
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_value_split_nonneg CHECK (purchased_cents >= 0 AND promo_cents >= 0);
-- Widen the status set (superset of active/redeemed/void → keeps existing rows valid).
ALTER TABLE gift_cards DROP CONSTRAINT IF EXISTS gift_cards_status_check;
ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check CHECK (status IN (
  'draft','pending_payment','active','scheduled','delivered','claimed','partially_redeemed','redeemed',
  'suspended','frozen','canceled','refunded','expired','lost_stolen','pending_review','void'
));

-- Widen the ledger transaction types (superset of issue/redeem/adjust/refund).
ALTER TABLE gift_card_transactions DROP CONSTRAINT IF EXISTS gift_card_transactions_type_check;
ALTER TABLE gift_card_transactions ADD CONSTRAINT gift_card_transactions_type_check CHECK (type IN (
  'issue','activate','purchase','promo_bonus','claim','transfer','hold','hold_release','redeem','redemption',
  'refund','adjust','freeze','unfreeze','cancel','expire','reactivate','chargeback'
));
-- Idempotency for money-moving ledger writes (retried activation / redemption never double-posts).
ALTER TABLE gift_card_transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_txns_idem
  ON gift_card_transactions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── 2. Multi-salon programs (opt-in; default gift cards are single-tenant) ──
CREATE TABLE IF NOT EXISTS gift_card_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_tenant_id UUID NOT NULL,                 -- the portfolio owner / liability holder
  name TEXT NOT NULL,
  shared_liability BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Which tenants participate in a program (redemption allowed only across members).
CREATE TABLE IF NOT EXISTS gift_card_program_members (
  program_id UUID NOT NULL REFERENCES gift_card_programs(id),
  tenant_id  UUID NOT NULL,
  PRIMARY KEY (program_id, tenant_id)
);

-- ── 3. Branded designs (reuse existing asset storage; store a URL/key, never base64) ──
CREATE TABLE IF NOT EXISTS gift_card_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  occasion TEXT,                                 -- birthday, thank_you, holiday, ...
  image_asset_key TEXT,                          -- reference into the asset store
  theme TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_designs_tenant ON gift_card_designs (tenant_id, is_active);

-- ── 4. Recipients + deliveries (buy-for-a-friend, scheduled send) ──
CREATE TABLE IF NOT EXISTS gift_card_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  customer_id UUID,                              -- set once claimed/linked to a canonical customer
  recipient_name TEXT,
  recipient_phone TEXT,                          -- E.164
  recipient_email TEXT,
  message TEXT,
  sender_name TEXT,
  anonymous BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_recipients_card ON gift_card_recipients (tenant_id, gift_card_id);

CREATE TABLE IF NOT EXISTS gift_card_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','in_app','link')),
  destination TEXT,                              -- masked in responses
  scheduled_at TIMESTAMPTZ,                      -- null = send now
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','scheduled','sending','sent','delivered','failed','canceled')),
  provider_message_id TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_deliveries_card ON gift_card_deliveries (tenant_id, gift_card_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_card_deliveries_due ON gift_card_deliveries (status, scheduled_at);

-- ── 5. Claim tokens (recipient proves ownership; single-use, hashed, expiring) ──
CREATE TABLE IF NOT EXISTS gift_card_claim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  token_hash TEXT NOT NULL,                      -- store a hash, never the raw token
  recipient_phone TEXT,
  recipient_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  claimed_by_customer_id UUID,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_claim_token_hash ON gift_card_claim_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_gift_card_claim_tokens_card ON gift_card_claim_tokens (tenant_id, gift_card_id);

-- ── 6. Presentation tokens (the SCANNED artifact: short-lived, single-use, no balance/PII encoded) ──
CREATE TABLE IF NOT EXISTS gift_card_presentation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  token_hash TEXT NOT NULL,                      -- hash of the opaque token; QR carries only id+nonce
  nonce TEXT NOT NULL,
  session_binding TEXT,                          -- optional device/session context
  expires_at TIMESTAMPTZ NOT NULL,              -- short (e.g. 60-120s)
  used_at TIMESTAMPTZ,                           -- single-use
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_presentation_token_hash ON gift_card_presentation_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_gift_card_presentation_tokens_card ON gift_card_presentation_tokens (tenant_id, gift_card_id, expires_at);

-- ── 7. Redemption holds (concurrency: reserve balance before checkout commits) ──
CREATE TABLE IF NOT EXISTS gift_card_redemption_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  branch_id UUID,
  ticket_id UUID,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','committed','released','expired')),
  idempotency_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Double-submit protection; SUM(active holds) <= available balance is enforced transactionally in code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_card_holds_idem
  ON gift_card_redemption_holds (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gift_card_holds_active ON gift_card_redemption_holds (gift_card_id, status);
CREATE INDEX IF NOT EXISTS idx_gift_card_holds_expiry ON gift_card_redemption_holds (status, expires_at);

-- ── 8. Fraud flags + controlled balance adjustments (reason + before/after + actor, no unlogged edits) ──
CREATE TABLE IF NOT EXISTS gift_card_fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  flag_type TEXT NOT NULL,                       -- replay, velocity, chargeback, takeover, ...
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  detail TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_fraud_flags_card ON gift_card_fraud_flags (tenant_id, gift_card_id, created_at);

CREATE TABLE IF NOT EXISTS gift_card_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  amount_cents INTEGER NOT NULL,                 -- signed delta
  balance_before_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id UUID,
  approved_by_user_id UUID,
  ledger_entry_id UUID,                          -- the paired gift_card_transactions row
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gift_card_adjustments_card ON gift_card_adjustments (tenant_id, gift_card_id, created_at);
