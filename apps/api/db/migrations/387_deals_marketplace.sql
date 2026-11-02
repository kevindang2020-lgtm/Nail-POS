-- 387_deals_marketplace.sql — Deals Marketplace canonical data model (Phase 1, additive only).
--
-- REUSE (not duplicated by this migration): branch coordinates + haversine distance (migrations 063/106) power the
-- "nearby" search; salon_promotions + promotion_redemptions + the checkout apply-promotion path remain the discount
-- primitive a published deal reuses at redemption time; the canonical service catalog, technicians, and customers are
-- referenced by FK. This migration adds ONLY the marketplace concepts that do not exist yet: deal ownership
-- (salon vs technician), the manager approval workflow, the tenant technician-deal policy, deal eligibility/schedule,
-- reservation holds for oversell-safe booking, saves, and analytics events. Money is integer cents throughout.

-- ── Tenant policy: whether/how technicians may create their own deals (§3 / §2 of the spec) ──────────────────────────
CREATE TABLE IF NOT EXISTS deal_settings (
  tenant_id                    UUID PRIMARY KEY,
  allow_technician_deals       TEXT NOT NULL DEFAULT 'off'
    CHECK (allow_technician_deals IN ('off','on_with_approval','on_auto')),   -- default OFF, per spec
  max_discount_percent         INTEGER,                                        -- NULL = no cap
  max_fixed_discount_cents     BIGINT,
  min_service_price_cents      BIGINT,
  max_active_deals_per_tech    INTEGER,
  max_redemptions_cap          INTEGER,
  max_campaign_duration_days   INTEGER,
  allowed_new_customer         BOOLEAN NOT NULL DEFAULT true,
  allowed_existing_customer    BOOLEAN NOT NULL DEFAULT true,
  allow_stack_loyalty          BOOLEAN NOT NULL DEFAULT false,
  allow_stack_membership       BOOLEAN NOT NULL DEFAULT false,
  editable_after_redemption    BOOLEAN NOT NULL DEFAULT false,
  updated_by_user_id           UUID,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── The marketplace deal (salon- or technician-owned) ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID REFERENCES branches(id),                 -- NULL = all branches (salon deals only)
  owner_type               TEXT NOT NULL CHECK (owner_type IN ('salon','technician')),
  technician_id            UUID REFERENCES technicians(id),              -- REQUIRED when owner_type='technician'
  title                    TEXT NOT NULL,
  short_description        TEXT,
  terms                    TEXT,
  image_url                TEXT,                                         -- object-storage URL (reuses existing storage)
  discount_type            TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_percent         INTEGER CHECK (discount_percent BETWEEN 1 AND 100),
  discount_cents           BIGINT CHECK (discount_cents >= 0),
  original_price_cents     BIGINT CHECK (original_price_cents >= 0),     -- from the canonical service catalog
  final_price_cents        BIGINT CHECK (final_price_cents >= 0),        -- never negative (enforced in service too)
  starts_at                TIMESTAMPTZ,
  ends_at                  TIMESTAMPTZ,
  days_of_week             SMALLINT[],                                   -- 0=Sun..6=Sat; NULL = any day
  valid_from_minute        SMALLINT,                                     -- minutes past midnight; NULL = all day
  valid_to_minute          SMALLINT,
  new_customers_only       BOOLEAN NOT NULL DEFAULT false,
  member_only              BOOLEAN NOT NULL DEFAULT false,
  min_spend_cents          BIGINT,
  booking_lead_minutes     INTEGER,
  deposit_cents            BIGINT CHECK (deposit_cents >= 0),
  max_redemptions          INTEGER,                                      -- NULL = unlimited
  max_per_customer         INTEGER,
  stackable                BOOLEAN NOT NULL DEFAULT false,
  allow_tech_substitution  BOOLEAN NOT NULL DEFAULT false,               -- technician deals: locked to the tech unless true
  status                   TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','scheduled','active','paused','sold_out','expired','rejected','canceled','archived')),
  created_by_user_id       UUID,
  created_by_technician_id UUID REFERENCES technicians(id),
  approved_by_user_id      UUID,
  redemption_count         INTEGER NOT NULL DEFAULT 0,
  version                  INTEGER NOT NULL DEFAULT 1,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_status   ON deals (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_branch          ON deals (branch_id);
CREATE INDEX IF NOT EXISTS idx_deals_technician      ON deals (technician_id);
CREATE INDEX IF NOT EXISTS idx_deals_window          ON deals (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_deals_active_feed     ON deals (tenant_id, branch_id, status) WHERE status = 'active';

-- ── Services a deal applies to (from the canonical service catalog) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_services (
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL,
  tenant_id   UUID NOT NULL,
  PRIMARY KEY (deal_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_services_service ON deal_services (service_id);

-- ── Manager/owner approval decisions (immutable audit; §7 "do not permit silent approval changes") ──────────────────
CREATE TABLE IF NOT EXISTS deal_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL,
  approver_user_id UUID,
  decision        TEXT NOT NULL CHECK (decision IN ('approved','rejected','changes_requested')),
  reason          TEXT,
  deal_version    INTEGER NOT NULL,
  terms_snapshot  JSONB,                                                 -- the terms as they stood at decision time
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_approvals_deal ON deal_approvals (deal_id, created_at);

-- ── Redemption reservation holds — oversell-safe booking (§12): exactly one hold per (deal, idempotency key) ─────────
CREATE TABLE IF NOT EXISTS deal_redemption_holds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  customer_id      UUID NOT NULL,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','consumed','released','expired')),
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_hold_idem ON deal_redemption_holds (deal_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_deal_holds_active   ON deal_redemption_holds (deal_id, status, expires_at);

-- ── Recorded redemptions (deal-specific attribution; reuses checkout for the actual discount application) ────────────
CREATE TABLE IF NOT EXISTS deal_redemptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                UUID NOT NULL REFERENCES deals(id),
  tenant_id              UUID NOT NULL,
  branch_id              UUID,
  customer_id            UUID NOT NULL,
  appointment_id         UUID,
  ticket_id              UUID,
  technician_id          UUID,
  amount_discounted_cents BIGINT NOT NULL DEFAULT 0,
  deal_version           INTEGER NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_redemptions_deal     ON deal_redemptions (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_redemptions_customer ON deal_redemptions (deal_id, customer_id);

-- ── Customer saves / favorites ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_saves (
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  tenant_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_saves_customer ON deal_saves (customer_id);

-- ── Analytics events (views/saves/shares/booking starts/bookings/redemptions) — real, deduped in the service ────────
CREATE TABLE IF NOT EXISTS deal_analytics_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  customer_id  UUID,
  event_type   TEXT NOT NULL CHECK (event_type IN ('view','save','unsave','share','booking_start','booking','redemption','cancel')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_events_deal ON deal_analytics_events (deal_id, event_type, created_at);
