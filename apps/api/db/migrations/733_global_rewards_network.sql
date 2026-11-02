-- 733_global_rewards_network.sql — AI PowerSalon Global Loyalty & Rewards Network + Prepaid Tenant Token Wallet
-- (LoyaltyTokens.pdf v1.0, Oct 30 2026) + Global & Tenant Earning Rules addendum (LoyaltyRules.pdf v2.0).
--
-- EXPAND-ONLY and idempotent. Nothing existing is touched: the salon's own tenant loyalty (loyalty_profiles /
-- loyalty_ledger / loyalty_point_earnings), gift cards and customer wallets stay exactly as they are and are NEVER
-- converted into global points by this migration (guide §9.1 / addendum §7.2). Every flag that turns the network on
-- is a platform flag that defaults OFF (global-rewards-flags.ts); with them off these tables simply stay empty.
--
-- Units (exact integer arithmetic, no floats anywhere):
--   money and token value   integer CENTS. 1 token = token_value_cents (initially 100) → 0.05 token = 5.
--   customer points         integer TENTHS of a point → 0.5 point = 5, 10 points = 100.
--   the program keeps cents-per-point-tenth integral (10 points = $1 → 1 tenth = 1 cent), so the token backing of any
--   award is an exact number of cents.
--
-- Tables
--   global_rewards_program            singleton: redemption value, token value, pauses, platform limits for custom rules
--   global_earning_rule_versions      Super Admin global default earning versions (effective-dated, immutable)
--   tenant_earning_policy_versions    a salon's GLOBAL / CUSTOM transitions + complete custom rates (versioned, immutable once activated)
--   global_rewards_enrollments        a salon's participation (enrolled / suspended / withdrawn + earning / purchasing holds)
--   tenant_token_wallets              ONE wallet per salon — a projection of token_wallet_ledger
--   token_wallet_ledger               append-only wallet history (one row per business source)
--   token_purchase_intents            Buy Tokens: one logical purchase per idempotency key; spendable only when FUNDS_VERIFIED
--   token_purchase_events             append-only purchase status history
--   global_rewards_accounts           a verified, opted-in customer identity's global points
--   global_points_ledger              append-only points history (one row per business source)
--   reward_earn_transactions          ONE judgement per paid ticket, with the full rule + funding snapshot
--   reward_redemptions                checkout reservations → committed redemptions
--   merchant_reimbursements           what the network owes the redeeming salon (PAYABLE ≠ PAID)
--   rewards_journal_entries / _lines  balanced double-entry journal (a deferred trigger refuses an unbalanced entry)

-- ── program ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_rewards_program (
  id                              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  earn_paused                     BOOLEAN NOT NULL DEFAULT false,
  redeem_paused                   BOOLEAN NOT NULL DEFAULT false,
  purchases_paused                BOOLEAN NOT NULL DEFAULT false,
  reimbursements_paused           BOOLEAN NOT NULL DEFAULT false,
  points_per_redeem_block         INTEGER NOT NULL DEFAULT 10 CHECK (points_per_redeem_block > 0),
  redeem_block_value_cents        INTEGER NOT NULL DEFAULT 100 CHECK (redeem_block_value_cents > 0),
  token_value_cents               INTEGER NOT NULL DEFAULT 100 CHECK (token_value_cents > 0),
  -- platform limits a salon's CUSTOM rule must stay inside (addendum §1.2)
  custom_min_spend_increment_cents INTEGER NOT NULL DEFAULT 100 CHECK (custom_min_spend_increment_cents > 0),
  custom_max_spend_increment_cents INTEGER NOT NULL DEFAULT 10000 CHECK (custom_max_spend_increment_cents >= custom_min_spend_increment_cents),
  custom_max_point_tenths_per_increment INTEGER NOT NULL DEFAULT 50 CHECK (custom_max_point_tenths_per_increment > 0),
  custom_min_eligible_floor_cents INTEGER NOT NULL DEFAULT 0 CHECK (custom_min_eligible_floor_cents >= 0),
  -- global safety cap on one ticket's award, applies to GLOBAL and CUSTOM alike
  max_point_tenths_per_ticket     INTEGER NOT NULL DEFAULT 10000 CHECK (max_point_tenths_per_ticket > 0),
  low_balance_cents               INTEGER NOT NULL DEFAULT 2000 CHECK (low_balance_cents >= 0),
  critical_balance_cents          INTEGER NOT NULL DEFAULT 500 CHECK (critical_balance_cents >= 0),
  reservation_ttl_seconds         INTEGER NOT NULL DEFAULT 900 CHECK (reservation_ttl_seconds BETWEEN 60 AND 86400),
  purchase_presets_tokens         INTEGER[] NOT NULL DEFAULT ARRAY[10, 25, 50, 100, 250, 500],
  max_purchase_tokens             INTEGER NOT NULL DEFAULT 5000 CHECK (max_purchase_tokens > 0),
  terms_version                   TEXT NOT NULL DEFAULT '2026-10-30',
  version                         INTEGER NOT NULL DEFAULT 1,
  updated_by                      UUID,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one point-tenth must be a whole number of cents (exact backing)
  CONSTRAINT ck_grp_exact_backing CHECK (redeem_block_value_cents % (points_per_redeem_block * 10) = 0)
);
INSERT INTO global_rewards_program (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── global default earning rule (Super Admin) ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_earning_rule_versions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no                  INTEGER NOT NULL UNIQUE,
  spend_increment_cents       INTEGER NOT NULL CHECK (spend_increment_cents > 0),
  point_tenths_per_increment  INTEGER NOT NULL CHECK (point_tenths_per_increment > 0),
  min_eligible_cents          INTEGER NOT NULL DEFAULT 0 CHECK (min_eligible_cents >= 0),
  per_ticket_cap_tenths       INTEGER CHECK (per_ticket_cap_tenths IS NULL OR per_ticket_cap_tenths > 0),
  rounding_mode               TEXT NOT NULL DEFAULT 'COMPLETED_INCREMENT' CHECK (rounding_mode IN ('COMPLETED_INCREMENT')),
  effective_from              TIMESTAMPTZ NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'canceled')),
  reason                      TEXT,
  published_by                UUID,
  canceled_by                 UUID,
  canceled_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gerv_effective ON global_earning_rule_versions (effective_from) WHERE status = 'published';
-- the guide's initial rule: every completed $5 earns 0.5 point ($10 = 1 point), in force from the start
INSERT INTO global_earning_rule_versions (version_no, spend_increment_cents, point_tenths_per_increment, effective_from, reason)
VALUES (1, 500, 5, '2000-01-01T00:00:00Z', 'Initial program rule (LoyaltyTokens.pdf §2.2): $5 = 0.5 point')
ON CONFLICT (version_no) DO NOTHING;

-- ── a salon's earning policy (addendum §1.1, §4.4, §4.5) ─────────────────────────────────────────────────────────
-- A row is a DRAFT (never resolved), or an ACTIVATED transition with its effective time (GLOBAL or a complete CUSTOM
-- rate), or DISCARDED (a draft thrown away) / CANCELED (an activation canceled before it took effect). Whether an
-- activated version is Scheduled, Active or Superseded is a matter of TIME, computed — never a stored flag that a
-- sweep must keep true. A missing row means GLOBAL (addendum §1.3: no per-tenant copy of the global rate).
CREATE TABLE IF NOT EXISTS tenant_earning_policy_versions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  version_no                  INTEGER NOT NULL,
  mode                        TEXT NOT NULL CHECK (mode IN ('GLOBAL', 'CUSTOM')),
  spend_increment_cents       INTEGER CHECK (spend_increment_cents IS NULL OR spend_increment_cents > 0),
  point_tenths_per_increment  INTEGER CHECK (point_tenths_per_increment IS NULL OR point_tenths_per_increment > 0),
  min_eligible_cents          INTEGER CHECK (min_eligible_cents IS NULL OR min_eligible_cents >= 0),
  per_ticket_cap_tenths       INTEGER CHECK (per_ticket_cap_tenths IS NULL OR per_ticket_cap_tenths > 0),
  rounding_mode               TEXT NOT NULL DEFAULT 'COMPLETED_INCREMENT' CHECK (rounding_mode IN ('COMPLETED_INCREMENT')),
  effective_from              TIMESTAMPTZ,
  status                      TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVATED', 'DISCARDED', 'CANCELED')),
  reason                      TEXT,
  created_by                  UUID,
  updated_by                  UUID,
  activated_by                UUID,
  activated_at                TIMESTAMPTZ,
  canceled_by                 UUID,
  canceled_at                 TIMESTAMPTZ,
  record_version              INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version_no),
  CONSTRAINT ck_tepv_custom_complete CHECK (mode = 'GLOBAL' OR (spend_increment_cents IS NOT NULL AND point_tenths_per_increment IS NOT NULL)),
  CONSTRAINT ck_tepv_activated_time CHECK (status <> 'ACTIVATED' OR effective_from IS NOT NULL)
);
-- no two activated transitions of one salon at the same instant (addendum T24: no overlapping intervals)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tepv_effective ON tenant_earning_policy_versions (tenant_id, effective_from) WHERE status = 'ACTIVATED';
CREATE INDEX IF NOT EXISTS ix_tepv_resolve ON tenant_earning_policy_versions (tenant_id, effective_from DESC) WHERE status = 'ACTIVATED';
CREATE INDEX IF NOT EXISTS ix_tepv_history ON tenant_earning_policy_versions (tenant_id, version_no DESC);

-- ── participation ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_rewards_enrollments (
  tenant_id             UUID PRIMARY KEY,
  status                TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'suspended', 'withdrawn')),
  earning_suspended     BOOLEAN NOT NULL DEFAULT false,
  purchasing_suspended  BOOLEAN NOT NULL DEFAULT false,
  terms_version         TEXT NOT NULL,
  enrolled_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_by           UUID,
  reason                TEXT,
  updated_by            UUID,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── tenant token wallet ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_token_wallets (
  tenant_id                 UUID PRIMARY KEY,
  available_cents           BIGINT NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  lifetime_funded_cents     BIGINT NOT NULL DEFAULT 0,
  lifetime_allocated_cents  BIGINT NOT NULL DEFAULT 0,
  deficit_cents             BIGINT NOT NULL DEFAULT 0 CHECK (deficit_cents >= 0),
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'locked')),
  alert_level               TEXT NOT NULL DEFAULT 'ok' CHECK (alert_level IN ('ok', 'low', 'critical', 'empty')),
  version                   BIGINT NOT NULL DEFAULT 0,
  updated_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_wallet_ledger (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  branch_id            UUID,
  entry_type           TEXT NOT NULL CHECK (entry_type IN ('purchase_funded', 'earn_allocation', 'earn_reversal', 'purchase_reversal', 'adjustment')),
  delta_cents          BIGINT NOT NULL,
  balance_after_cents  BIGINT NOT NULL CHECK (balance_after_cents >= 0),
  source_table         TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  actor_user_id        UUID,
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_table, source_id, entry_type)
);
CREATE INDEX IF NOT EXISTS ix_twl_tenant_time ON token_wallet_ledger (tenant_id, created_at DESC, id DESC);
CREATE OR REPLACE FUNCTION token_wallet_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'token_wallet_ledger is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_twl_append_only ON token_wallet_ledger;
CREATE TRIGGER trg_twl_append_only BEFORE UPDATE OR DELETE ON token_wallet_ledger FOR EACH ROW EXECUTE FUNCTION token_wallet_ledger_append_only();

-- ── Buy Tokens ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS token_purchase_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  token_cents       BIGINT NOT NULL CHECK (token_cents > 0),
  amount_cents      BIGINT NOT NULL CHECK (amount_cents > 0),
  fee_cents         BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  currency          TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status            TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED',
                      'SETTLEMENT_PENDING', 'FUNDS_VERIFIED', 'FAILED', 'DECLINED', 'REVERSED', 'CHARGED_BACK', 'CANCELED')),
  idempotency_key   TEXT NOT NULL,
  provider          TEXT NOT NULL,
  provider_ref      TEXT,
  policy_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  initiated_by      UUID,
  failure_code      TEXT,
  confirmed_at      TIMESTAMPTZ,
  funded_at         TIMESTAMPTZ,
  updated_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpi_provider_ref ON token_purchase_intents (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tpi_tenant_time ON token_purchase_intents (tenant_id, created_at DESC, id DESC);
-- one purchase in flight per salon: a second Buy while one is PROCESSING / UNKNOWN is refused (no double charge)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpi_one_in_flight ON token_purchase_intents (tenant_id) WHERE status IN ('REQUESTED', 'PROCESSING', 'UNKNOWN');

CREATE TABLE IF NOT EXISTS token_purchase_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  intent_id     UUID NOT NULL REFERENCES token_purchase_intents (id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  source        TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tpe_intent ON token_purchase_events (intent_id, created_at);

-- ── customer global rewards ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_rewards_accounts (
  identity_id               UUID PRIMARY KEY REFERENCES customer_identities (id),
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  available_tenths          BIGINT NOT NULL DEFAULT 0 CHECK (available_tenths >= 0),
  reserved_tenths           BIGINT NOT NULL DEFAULT 0 CHECK (reserved_tenths >= 0),
  lifetime_earned_tenths    BIGINT NOT NULL DEFAULT 0,
  lifetime_redeemed_tenths  BIGINT NOT NULL DEFAULT 0,
  terms_version             TEXT NOT NULL,
  enrolled_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_via              TEXT NOT NULL CHECK (enrolled_via IN ('customer_app', 'pos_verified')),
  version                   BIGINT NOT NULL DEFAULT 0,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS global_points_ledger (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id           UUID NOT NULL REFERENCES customer_identities (id),
  entry_type            TEXT NOT NULL CHECK (entry_type IN ('earn', 'redeem', 'earn_reversal', 'redeem_reversal', 'adjustment')),
  delta_tenths          BIGINT NOT NULL,
  balance_after_tenths  BIGINT NOT NULL CHECK (balance_after_tenths >= 0),
  tenant_id             UUID NOT NULL,           -- the salon whose sale / redemption caused it (privacy: other salons never see the row)
  branch_id             UUID,
  source_table          TEXT NOT NULL,
  source_id             TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_gpl_source UNIQUE (tenant_id, source_table, source_id, entry_type)
);
CREATE INDEX IF NOT EXISTS ix_gpl_identity_time ON global_points_ledger (identity_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_gpl_tenant_time ON global_points_ledger (tenant_id, created_at DESC, id DESC);
CREATE OR REPLACE FUNCTION global_points_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'global_points_ledger is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_gpl_append_only ON global_points_ledger;
CREATE TRIGGER trg_gpl_append_only BEFORE UPDATE OR DELETE ON global_points_ledger FOR EACH ROW EXECUTE FUNCTION global_points_ledger_append_only();

-- ── earning (one judgement per paid ticket) ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reward_earn_transactions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID,
  ticket_id                   UUID NOT NULL,
  customer_id                 UUID,
  identity_id                 UUID,
  effective_at                TIMESTAMPTZ NOT NULL,
  eligible_cents              BIGINT NOT NULL CHECK (eligible_cents >= 0),
  rule_source                 TEXT CHECK (rule_source IS NULL OR rule_source IN ('GLOBAL_DEFAULT', 'TENANT_OVERRIDE')),
  rule_version_id             UUID,
  spend_increment_cents       INTEGER,
  point_tenths_per_increment  INTEGER,
  min_eligible_cents          INTEGER,
  per_ticket_cap_tenths       INTEGER,
  rounding_mode               TEXT,
  cents_per_point_tenth       INTEGER,
  point_tenths                BIGINT NOT NULL DEFAULT 0 CHECK (point_tenths >= 0),
  backing_cents               BIGINT NOT NULL DEFAULT 0 CHECK (backing_cents >= 0),
  status                      TEXT NOT NULL CHECK (status IN ('EARNED', 'NOT_ELIGIBLE', 'BLOCKED_POLICY', 'BLOCKED_INSUFFICIENT_TOKENS', 'PARTIALLY_REVERSED', 'REVERSED')),
  block_reason                TEXT,
  reversed_tenths             BIGINT NOT NULL DEFAULT 0 CHECK (reversed_tenths >= 0),
  reversed_backing_cents      BIGINT NOT NULL DEFAULT 0 CHECK (reversed_backing_cents >= 0),
  source_event_id             TEXT,
  updated_by                  UUID,                    -- NULL: only the earn processor / refund reversal (no person) writes this row
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ticket_id),
  CONSTRAINT ck_ret_reversal_bounds CHECK (reversed_tenths <= point_tenths AND reversed_backing_cents <= backing_cents)
);
CREATE INDEX IF NOT EXISTS ix_ret_tenant_time ON reward_earn_transactions (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_ret_identity ON reward_earn_transactions (identity_id, created_at DESC) WHERE identity_id IS NOT NULL;

-- ── redemption ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,             -- the REDEEMING salon
  branch_id        UUID,
  ticket_id        UUID NOT NULL,
  identity_id      UUID NOT NULL REFERENCES customer_identities (id),
  point_tenths     BIGINT NOT NULL CHECK (point_tenths > 0),
  value_cents      BIGINT NOT NULL CHECK (value_cents > 0),
  status           TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED', 'HELD', 'REVERSED')),
  idempotency_key  TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  reserved_by      UUID,
  committed_at     TIMESTAMPTZ,
  released_at      TIMESTAMPTZ,
  release_reason   TEXT,
  updated_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
-- one live reward per ticket
CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_ticket_live ON reward_redemptions (tenant_id, ticket_id) WHERE status IN ('RESERVED', 'HELD', 'COMMITTED');
CREATE INDEX IF NOT EXISTS ix_rr_tenant_time ON reward_redemptions (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_rr_expiry ON reward_redemptions (expires_at) WHERE status = 'RESERVED';

CREATE TABLE IF NOT EXISTS merchant_reimbursements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,               -- the salon OWED the money
  redemption_id  UUID NOT NULL UNIQUE REFERENCES reward_redemptions (id),
  amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
  status         TEXT NOT NULL DEFAULT 'PAYABLE' CHECK (status IN ('PAYABLE', 'BATCHED', 'SUBMITTED', 'PROCESSING', 'PAID', 'FAILED', 'UNKNOWN', 'REVERSED')),
  batch_id       UUID,
  provider       TEXT,
  provider_ref   TEXT,
  paid_at        TIMESTAMPTZ,
  updated_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_mr_paid_needs_provider CHECK (status <> 'PAID' OR (provider_ref IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_mr_tenant_status ON merchant_reimbursements (tenant_id, status, created_at DESC);

-- ── balanced journal ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rewards_journal_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type    TEXT NOT NULL CHECK (entry_type IN ('token_purchase_funded', 'earn_allocation', 'earn_reversal', 'redemption_committed',
                  'redemption_reversed', 'reimbursement_paid', 'purchase_reversed')),
  tenant_id     UUID,
  source_table  TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  memo          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id, entry_type)
);
CREATE TABLE IF NOT EXISTS rewards_journal_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      UUID NOT NULL REFERENCES rewards_journal_entries (id),
  account       TEXT NOT NULL CHECK (account IN ('settlement_cash', 'merchant_prepaid_liability', 'rewards_liability',
                  'reimbursement_payable', 'funding_deficit_receivable')),
  tenant_id     UUID,
  debit_cents   BIGINT NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents  BIGINT NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_rjl_one_side CHECK ((debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX IF NOT EXISTS ix_rjl_entry ON rewards_journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS ix_rjl_account ON rewards_journal_lines (account, tenant_id);
-- an entry must balance when its transaction commits
CREATE OR REPLACE FUNCTION rewards_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d BIGINT; c BIGINT;
BEGIN
  SELECT coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0) INTO d, c FROM rewards_journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN RAISE EXCEPTION 'rewards journal entry % is unbalanced (debits %, credits %)', NEW.entry_id, d, c; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_rjl_balanced ON rewards_journal_lines;
CREATE CONSTRAINT TRIGGER trg_rjl_balanced AFTER INSERT ON rewards_journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION rewards_journal_balanced();
CREATE OR REPLACE FUNCTION rewards_journal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'the rewards journal is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_rje_append_only ON rewards_journal_entries;
CREATE TRIGGER trg_rje_append_only BEFORE UPDATE OR DELETE ON rewards_journal_entries FOR EACH ROW EXECUTE FUNCTION rewards_journal_append_only();
DROP TRIGGER IF EXISTS trg_rjl_append_only ON rewards_journal_lines;
CREATE TRIGGER trg_rjl_append_only BEFORE UPDATE OR DELETE ON rewards_journal_lines FOR EACH ROW EXECUTE FUNCTION rewards_journal_append_only();
