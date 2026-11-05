-- 522_deals_engine.sql — BUILD_PLAN Phase 5 (deals_engine), the EXPAND step of an expand-then-contract consolidation.
--
-- One `deals` domain becomes the source of truth for every promotional price. Until now there were five stores:
-- customer_deals (045, written by nothing, read by the customer app and the AI receptionist), salon_promotions (319, the
-- POS coupon path, plaintext codes), tenant_promotions (257, the richest model, no caller), deals (387) and bundles (133,
-- package pricing — stays its own thing). This migration:
--   1. extends `deals` so one row can be a booked/applied deal, a coupon (code-gated), an automatic promotion or a
--      display-only announcement — with rules, priority, stack group, cap, budget, channels and the Super Admin suspension;
--   2. turns `deal_redemption_holds` into the ONE capacity ledger (a ticket or an appointment holds a place; consumed and
--      redeemed places COUNT — bug 1) and `deal_redemptions` into the per-ticket application ledger (applied → redeemed at
--      PAYMENT → released / reversed on void or refund — bug 4), with per-line allocations and the terms snapshot;
--   3. adds hashed single-use coupon codes + batches, a lookup-failure ledger (rate limit), versions and daily stats;
--   4. backfills salon_promotions / tenant_promotions / customer_deals into `deals` (idempotent, keyed by legacy id).
-- The CONTRACT step (523) freezes the three legacy tables against writes; dropping them is a later release's job, once a
-- deploy has run on the new reads (decided — see BUILD_PHASES_REPORT Phase 5).

-- ── 1. deals: one row per promotional offer ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'deal';
DO $$ BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_kind_check CHECK (kind IN ('deal','coupon','automatic','announcement'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL DEFAULT '{}'::jsonb;          -- the rule builder (AND/OR groups)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;             -- lower first on a tie
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stack_group TEXT;                                  -- same group never stacks
ALTER TABLE deals ADD COLUMN IF NOT EXISTS max_discount_cents BIGINT CHECK (max_discount_cents IS NULL OR max_discount_cents > 0);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS budget_cents BIGINT CHECK (budget_cents IS NULL OR budget_cents > 0);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS budget_reserved_cents BIGINT NOT NULL DEFAULT 0;
DO $$ BEGIN   -- the budget can never be overspent: the database refuses the reservation that would pass it
  ALTER TABLE deals ADD CONSTRAINT deals_budget_within CHECK (budget_reserved_cents >= 0 AND (budget_cents IS NULL OR budget_reserved_cents <= budget_cents));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS channels TEXT[];                                    -- NULL = every channel
ALTER TABLE deals ADD COLUMN IF NOT EXISTS requires_code BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS legacy_source TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS legacy_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deals_legacy ON deals (legacy_source, legacy_id) WHERE legacy_source IS NOT NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS suspended_by TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_discount_type_check;
DO $$ BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_discount_type_check CHECK (discount_type IN ('percent','fixed','fixed_price'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_kind_status ON deals (tenant_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_deals_lifecycle ON deals (status, starts_at, ends_at) WHERE status IN ('approved','scheduled','active');

-- ── tenant policy: how offers combine, the price floor, the tenant's own switch and the platform's ─────────────────────
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS stacking_policy TEXT NOT NULL DEFAULT 'best_single';
DO $$ BEGIN
  ALTER TABLE deal_settings ADD CONSTRAINT deal_settings_stacking_check CHECK (stacking_policy IN ('best_single','stack_all','stack_groups','exclusive'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS price_floor_percent INTEGER NOT NULL DEFAULT 0 CHECK (price_floor_percent BETWEEN 0 AND 100);
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS max_total_discount_percent INTEGER CHECK (max_total_discount_percent IS NULL OR max_total_discount_percent BETWEEN 1 AND 100);
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS deals_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS platform_disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS platform_disabled_reason TEXT;
ALTER TABLE deal_settings ADD COLUMN IF NOT EXISTS platform_max_active_deals INTEGER CHECK (platform_max_active_deals IS NULL OR platform_max_active_deals >= 0);

-- ── 2. the capacity ledger: every use of a deal holds ONE place ────────────────────────────────────────────────────────
ALTER TABLE deal_redemption_holds DROP CONSTRAINT IF EXISTS deal_redemption_holds_status_check;
DO $$ BEGIN
  ALTER TABLE deal_redemption_holds ADD CONSTRAINT deal_redemption_holds_status_check CHECK (status IN ('held','consumed','redeemed','released','expired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE deal_redemption_holds ADD COLUMN IF NOT EXISTS ticket_id UUID;
ALTER TABLE deal_redemption_holds ADD COLUMN IF NOT EXISTS released_reason TEXT;
ALTER TABLE deal_redemption_holds ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE deal_redemption_holds ALTER COLUMN customer_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_holds_ticket ON deal_redemption_holds (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_holds_customer ON deal_redemption_holds (deal_id, customer_id, status);

-- the per-ticket application ledger (applied → redeemed at payment → released / reversed)
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'redeemed';
DO $$ BEGIN
  ALTER TABLE deal_redemptions ADD CONSTRAINT deal_redemptions_status_check CHECK (status IN ('applied','redeemed','released','reversed','partially_reversed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'deal';
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS hold_id UUID;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS coupon_code_id UUID;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS line_allocations JSONB;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS terms_snapshot JSONB;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS applied_by_user_id UUID;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS reversed_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS budget_reserved_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE deal_redemptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE deal_redemptions ALTER COLUMN customer_id DROP NOT NULL;
UPDATE deal_redemptions SET redeemed_at = created_at WHERE redeemed_at IS NULL AND status = 'redeemed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_redemption_ticket_live ON deal_redemptions (ticket_id, deal_id) WHERE status IN ('applied','redeemed') AND ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_redemption_idem ON deal_redemptions (deal_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_redemptions_ticket ON deal_redemptions (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_deal_redemptions_status ON deal_redemptions (tenant_id, status, applied_at);

ALTER TABLE deal_analytics_events DROP CONSTRAINT IF EXISTS deal_analytics_events_event_type_check;
DO $$ BEGIN
  ALTER TABLE deal_analytics_events ADD CONSTRAINT deal_analytics_events_event_type_check
    CHECK (event_type IN ('view','save','unsave','share','booking_start','booking','redemption','cancel','apply','release','reversal'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. coupons: hashed codes (never stored in plaintext), batches, lookup failures ────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_coupon_batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  deal_id            UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  quantity           INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  prefix             TEXT,
  single_use         BOOLEAN NOT NULL DEFAULT true,
  purpose            TEXT NOT NULL DEFAULT 'manual' CHECK (purpose IN ('manual','marketing','wallet','legacy')),
  campaign_id        UUID,
  expires_at         TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_coupon_batches_deal ON deal_coupon_batches (tenant_id, deal_id);

CREATE TABLE IF NOT EXISTS deal_coupon_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  deal_id        UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  batch_id       UUID REFERENCES deal_coupon_batches(id) ON DELETE SET NULL,
  code_hash      TEXT NOT NULL,                       -- sha256(tenant ':' normalized code) — the code itself is never stored
  code_hint      TEXT NOT NULL,                       -- the last 4 characters, for staff and the customer to recognise it
  single_use     BOOLEAN NOT NULL DEFAULT true,
  max_uses       INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  use_count      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','exhausted')),
  customer_id    UUID,                                -- a wallet coupon: only this customer may use it
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deal_coupon_codes_uses CHECK (use_count >= 0 AND (max_uses IS NULL OR use_count <= max_uses) AND (NOT single_use OR use_count <= 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_coupon_code ON deal_coupon_codes (tenant_id, code_hash);
CREATE INDEX IF NOT EXISTS idx_deal_coupon_codes_deal ON deal_coupon_codes (deal_id, status);
CREATE INDEX IF NOT EXISTS idx_deal_coupon_codes_customer ON deal_coupon_codes (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deal_code_lookup_failures (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  actor_key  TEXT NOT NULL,                           -- user / device — never the code that was tried
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_code_failures ON deal_code_lookup_failures (tenant_id, actor_key, created_at);

-- ── versions (every change to the terms a customer sees) and the daily aggregation ────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id          UUID NOT NULL,
  version            INTEGER NOT NULL,
  terms              JSONB NOT NULL,
  changed_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, version)
);

CREATE TABLE IF NOT EXISTS deal_daily_stats (
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  day              DATE NOT NULL,
  views            INTEGER NOT NULL DEFAULT 0,
  saves            INTEGER NOT NULL DEFAULT 0,
  booking_starts   INTEGER NOT NULL DEFAULT 0,
  bookings         INTEGER NOT NULL DEFAULT 0,
  applications     INTEGER NOT NULL DEFAULT 0,
  redemptions      INTEGER NOT NULL DEFAULT 0,
  reversals        INTEGER NOT NULL DEFAULT 0,
  discounted_cents BIGINT NOT NULL DEFAULT 0,
  reversed_cents   BIGINT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, day)
);
CREATE INDEX IF NOT EXISTS idx_deal_daily_stats_tenant ON deal_daily_stats (tenant_id, day);

-- ── 4. backfill (idempotent: keyed by legacy source + id) ─────────────────────────────────────────────────────────────
-- salon_promotions → kind 'coupon' (the shared code becomes a hashed, multi-use code row)
INSERT INTO deals (tenant_id, branch_id, owner_type, kind, title, discount_type, discount_percent, discount_cents,
                   min_spend_cents, status, starts_at, ends_at, max_redemptions, redemption_count, stackable,
                   requires_code, created_by_user_id, legacy_source, legacy_id, created_at, updated_at)
SELECT sp.tenant_id, sp.branch_id, 'salon', 'coupon', sp.name, sp.discount_type,
       CASE WHEN sp.discount_type = 'percent' THEN sp.discount_percent END,
       CASE WHEN sp.discount_type = 'fixed' THEN sp.discount_cents END,
       NULLIF(sp.min_purchase_cents, 0),
       CASE sp.status WHEN 'draft' THEN 'draft' WHEN 'active' THEN 'active' WHEN 'paused' THEN 'paused' WHEN 'expired' THEN 'expired' ELSE 'archived' END,
       sp.starts_at, sp.ends_at, sp.max_redemptions, sp.redemption_count, true, true, sp.created_by_user_id,
       'salon_promotions', sp.id, sp.created_at, sp.updated_at
FROM salon_promotions sp
WHERE (sp.discount_type = 'fixed' AND sp.discount_cents IS NOT NULL AND sp.discount_cents >= 0)
   OR (sp.discount_type = 'percent' AND sp.discount_percent BETWEEN 1 AND 100)
ON CONFLICT (legacy_source, legacy_id) WHERE legacy_source IS NOT NULL DO NOTHING;

INSERT INTO deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, single_use, max_uses, use_count, status)
SELECT d.tenant_id, d.id,
       encode(sha256(convert_to(d.tenant_id::text || ':' || upper(regexp_replace(sp.code, '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex'),
       right(upper(regexp_replace(sp.code, '[^A-Za-z0-9]', '', 'g')), 4), false, NULL, 0, 'active'
FROM deals d JOIN salon_promotions sp ON d.legacy_source = 'salon_promotions' AND d.legacy_id = sp.id
WHERE length(regexp_replace(sp.code, '[^A-Za-z0-9]', '', 'g')) > 0
ON CONFLICT (tenant_id, code_hash) DO NOTHING;

-- tenant_promotions → kind 'automatic' (percentage / fixed-value types only; buy_x_get_y and platform_sponsored stay
-- in the legacy table — nothing ever created or redeemed them)
INSERT INTO deals (tenant_id, branch_id, owner_type, kind, title, discount_type, discount_percent, discount_cents,
                   max_discount_cents, min_spend_cents, status, starts_at, ends_at, max_redemptions, max_per_customer,
                   new_customers_only, stackable, created_by_user_id, legacy_source, legacy_id, created_at, updated_at)
SELECT tp.tenant_id, tp.branch_id, 'salon', 'automatic', tp.name,
       CASE WHEN tp.promotion_type = 'percentage' THEN 'percent' ELSE 'fixed' END,
       CASE WHEN tp.promotion_type = 'percentage' THEN tp.discount_value END,
       CASE WHEN tp.promotion_type <> 'percentage' THEN tp.discount_value END,
       CASE WHEN tp.max_discount_cents > 0 THEN tp.max_discount_cents END,
       NULLIF(tp.min_purchase_cents, 0),
       CASE tp.status WHEN 'draft' THEN 'draft' WHEN 'pending_approval' THEN 'pending_approval' WHEN 'approved' THEN 'approved'
                      WHEN 'scheduled' THEN 'scheduled' WHEN 'active' THEN 'active' WHEN 'paused' THEN 'paused'
                      WHEN 'completed' THEN 'expired' WHEN 'expired' THEN 'expired' WHEN 'rejected' THEN 'rejected'
                      WHEN 'archived' THEN 'archived' ELSE 'canceled' END,
       tp.start_at, tp.end_at,
       NULLIF(LEAST(NULLIF(tp.tenant_limit, 0), NULLIF(tp.global_limit, 0)), 0), NULLIF(tp.customer_limit, 0),
       tp.promotion_type = 'new_client', tp.stacking_policy <> 'none', tp.created_by, 'tenant_promotions', tp.id, tp.created_at, tp.updated_at
FROM tenant_promotions tp
WHERE tp.owner_type = 'tenant'
  AND ((tp.promotion_type = 'percentage' AND tp.discount_value BETWEEN 1 AND 100)
    OR (tp.promotion_type IN ('fixed_amount','new_client','bundle','package','free_service','free_product') AND tp.discount_value >= 0))
ON CONFLICT (legacy_source, legacy_id) WHERE legacy_source IS NOT NULL DO NOTHING;

-- customer_deals → kind 'announcement' (display only: it never carried a discount the system could apply)
INSERT INTO deals (tenant_id, owner_type, kind, title, short_description, terms, discount_type, discount_cents, status,
                   starts_at, ends_at, priority, legacy_source, legacy_id, created_at, updated_at)
SELECT cd.tenant_id, 'salon', 'announcement', cd.title, cd.description,
       CASE WHEN cd.code IS NOT NULL AND cd.code <> '' THEN 'Mention code ' || cd.code || ' at the front desk.' END,
       'fixed', 0, CASE WHEN cd.active THEN 'active' ELSE 'archived' END,
       cd.starts_at, cd.ends_at, cd.sort_order, 'customer_deals', cd.id, cd.created_at, cd.created_at
FROM customer_deals cd
ON CONFLICT (legacy_source, legacy_id) WHERE legacy_source IS NOT NULL DO NOTHING;
