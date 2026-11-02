-- 170_memberships.sql — Canonical Memberships engine (Phase 1). Customer subscription/package/discount memberships,
-- built on the existing canonical records (customers / services / tickets / payments). This is the data foundation only;
-- the lifecycle state machine, billing schedules, redemption, commission split, and UI are layered on top in later phases.
--
-- Design invariants:
--   * Money is integer cents (BIGINT), never floating point. Tenant identity is server-derived; every row carries tenant_id.
--   * A published plan VERSION is immutable — editing a plan creates a new version; existing memberships keep their version.
--   * The credit ledger is append-only (issue / reserve / redeem / rollover / expire / restore / adjust); a member's
--     available balance is DERIVED by summing the ledger, never stored as a mutable counter (prevents double-spend drift).
--   * Redemptions and audit rows are immutable snapshots and are never destroyed.

-- ── Plan template (mutable header; points at its current immutable version) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  branch_id             UUID,                                    -- NULL = available at all branches
  name                  TEXT NOT NULL,
  plan_code             TEXT,                                    -- internal code, unique per tenant when set
  product_type          TEXT NOT NULL DEFAULT 'recurring',       -- recurring | fixed_term | package | discount_club | hybrid
  description           TEXT,
  internal_notes        TEXT,
  badge                 TEXT,                                    -- display badge e.g. 'Most Popular' | 'Seasonal'
  is_featured           BOOLEAN NOT NULL DEFAULT false,
  is_popular            BOOLEAN NOT NULL DEFAULT false,
  member_visible        BOOLEAN NOT NULL DEFAULT true,           -- shown to customers (vs internal/invite-only)
  status                TEXT NOT NULL DEFAULT 'draft',           -- draft | active | archived
  current_version_id    UUID,                                    -- → membership_plan_versions.id (the published version)
  created_by_user_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_plans_tenant_status ON membership_plans (tenant_id, status);
CREATE INDEX IF NOT EXISTS membership_plans_tenant_branch ON membership_plans (tenant_id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS membership_plans_tenant_code ON membership_plans (tenant_id, plan_code) WHERE plan_code IS NOT NULL;

-- ── Immutable published version (the contract a member is bound to) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_plan_versions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                  UUID NOT NULL,
  tenant_id                UUID NOT NULL,
  version_number           INTEGER NOT NULL,
  -- billing
  billing_interval         TEXT NOT NULL DEFAULT 'month',        -- month | quarter | six_month | year | none | custom
  interval_count           INTEGER NOT NULL DEFAULT 1,
  price_cents              BIGINT NOT NULL DEFAULT 0,
  is_custom_pricing        BOOLEAN NOT NULL DEFAULT false,       -- 'Custom Pricing' plans (e.g. corporate)
  enrollment_fee_cents     BIGINT NOT NULL DEFAULT 0,
  setup_fee_cents          BIGINT NOT NULL DEFAULT 0,
  trial_days               INTEGER NOT NULL DEFAULT 0,
  auto_renew               BOOLEAN NOT NULL DEFAULT true,
  billing_cycles           INTEGER,                              -- NULL = until canceled; N = fixed number of cycles
  -- term (for fixed-term / prepaid)
  term_type                TEXT NOT NULL DEFAULT 'none',         -- none | fixed
  term_days                INTEGER,                              -- fixed-term length in days
  -- credits & rollover defaults
  rollover_allowed         BOOLEAN NOT NULL DEFAULT false,
  rollover_max_cycles      INTEGER NOT NULL DEFAULT 0,
  credit_expiry_days       INTEGER,                              -- NULL = expires at next reset
  -- technician revenue split (default 60/40); tax & tips are ALWAYS separate from this split
  tech_commission_basis    TEXT NOT NULL DEFAULT 'allocated',    -- standard | allocated | actual_paid | fixed | percent
  tech_split_pct           NUMERIC(5,2) NOT NULL DEFAULT 60.00,
  owner_split_pct          NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  tech_fixed_cents         BIGINT,                               -- when basis = fixed
  allocation_timing        TEXT NOT NULL DEFAULT 'on_redemption',-- on_billing | on_redemption | hybrid
  -- policy
  tax_category             TEXT,
  cancellation_policy      TEXT NOT NULL DEFAULT 'period_end',   -- immediate | period_end | term_end
  min_commitment_cycles    INTEGER NOT NULL DEFAULT 0,
  pause_max_per_year       INTEGER NOT NULL DEFAULT 0,
  pause_max_days           INTEGER NOT NULL DEFAULT 0,
  -- agreement / disclosure (negative-option compliance: explicit terms + auto-renew disclosure, versioned)
  terms_version            TEXT,
  auto_renew_disclosure    TEXT,
  -- profitability snapshot captured at publish (for the guardrail preview; advisory)
  est_margin_cents         BIGINT,
  -- lifecycle
  is_published             BOOLEAN NOT NULL DEFAULT false,
  effective_at             TIMESTAMPTZ,
  published_by_user_id     UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_plan_versions_plan_ver ON membership_plan_versions (plan_id, version_number);
CREATE INDEX IF NOT EXISTS membership_plan_versions_tenant ON membership_plan_versions (tenant_id);

-- ── Per-version benefit definitions (service credits / dollar credits / discounts / perks) ──────────────────────────
CREATE TABLE IF NOT EXISTS membership_benefits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id       UUID NOT NULL,
  tenant_id             UUID NOT NULL,
  benefit_type          TEXT NOT NULL,                           -- service_credit | dollar_credit | percent_discount |
                                                                 -- fixed_discount | product_discount | addon | priority_booking |
                                                                 -- waitlist_priority | free_upgrade | birthday | guest_pass |
                                                                 -- loyalty_multiplier | exclusive_deals | early_access
  label                 TEXT NOT NULL,                           -- name snapshot for display without a join
  service_id            UUID,                                    -- eligible service when scoped to one
  category_snapshot     TEXT,                                    -- eligible category name snapshot
  credits_per_cycle     INTEGER NOT NULL DEFAULT 0,              -- service-credit quantity granted each cycle
  value_cents           BIGINT NOT NULL DEFAULT 0,               -- dollar-credit value / fixed-discount amount
  percent               NUMERIC(5,2) NOT NULL DEFAULT 0,         -- percent-discount value
  allocated_value_cents BIGINT NOT NULL DEFAULT 0,               -- membership "allocated service value" for commission/redemption
  min_days_between      INTEGER NOT NULL DEFAULT 0,              -- fair-use: min days between redemptions
  max_per_cycle         INTEGER,                                 -- fair-use: cap per cycle (NULL = the credit count governs)
  rollover_allowed      BOOLEAN NOT NULL DEFAULT false,
  sort_order            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS membership_benefits_version ON membership_benefits (plan_version_id);
CREATE INDEX IF NOT EXISTS membership_benefits_tenant ON membership_benefits (tenant_id);

-- ── The customer's membership instance (the subscription/enrollment, bound to one immutable version) ────────────────
CREATE TABLE IF NOT EXISTS customer_memberships (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID NOT NULL,
  customer_id              UUID NOT NULL,
  plan_id                  UUID NOT NULL,
  plan_version_id          UUID NOT NULL,                        -- the version this member is contracted on (immutable)
  status                   TEXT NOT NULL DEFAULT 'pending',      -- pending | trial | active | grace | past_due | paused |
                                                                 -- canceling | canceled | expired | suspended | comped | completed
  assigned_technician_id   UUID,                                 -- selected technician for tech-assigned plans
  member_number            TEXT,                                 -- human-facing membership number
  -- period / billing schedule
  started_at               TIMESTAMPTZ,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  next_billing_at          TIMESTAMPTZ,                          -- next scheduled charge (NULL for fixed-term/manual)
  term_end_at              TIMESTAMPTZ,                          -- fixed-term expiry
  cycles_billed            INTEGER NOT NULL DEFAULT 0,
  -- consent / agreement (explicit + separate auto-renew consent, versioned — negative-option compliance)
  auto_renew               BOOLEAN NOT NULL DEFAULT true,
  auto_renew_consent_at    TIMESTAMPTZ,
  agreement_version        TEXT,
  enrolled_channel         TEXT,                                 -- pos | customer_app | checkout | manager | marketing | ai
  enrolled_by_user_id      UUID,
  -- lifecycle stamps
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  canceled_at              TIMESTAMPTZ,
  cancel_reason            TEXT,
  paused_at                TIMESTAMPTZ,
  pause_resumes_at         TIMESTAMPTZ,
  pauses_used              INTEGER NOT NULL DEFAULT 0,
  comped                   BOOLEAN NOT NULL DEFAULT false,
  -- optimistic concurrency (HTTP 409 on stale write, same pattern as tickets)
  version                  INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_memberships_tenant_status ON customer_memberships (tenant_id, status);
CREATE INDEX IF NOT EXISTS customer_memberships_tenant_customer ON customer_memberships (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS customer_memberships_tenant_billing ON customer_memberships (tenant_id, next_billing_at);
CREATE INDEX IF NOT EXISTS customer_memberships_plan ON customer_memberships (plan_id);
CREATE INDEX IF NOT EXISTS customer_memberships_branch ON customer_memberships (tenant_id, branch_id);

-- ── Append-only credit ledger (balance is DERIVED by summing entries; never a mutable counter) ──────────────────────
CREATE TABLE IF NOT EXISTS membership_credit_ledger (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  customer_membership_id   UUID NOT NULL,
  benefit_id               UUID,                                 -- which benefit def this entry relates to
  entry_type               TEXT NOT NULL,                        -- issued | reserved | redeemed | released | rolled_over |
                                                                 -- expired | restored | adjusted
  service_id               UUID,                                 -- for service credits
  quantity                 INTEGER NOT NULL DEFAULT 0,           -- +grant / −consume of service credits (signed)
  amount_cents             BIGINT NOT NULL DEFAULT 0,            -- +grant / −consume of dollar credits (signed)
  ticket_id                UUID,                                 -- redemption linkage
  reservation_ref          UUID,                                 -- links reserve → redeem/release for the same hold
  expires_at               TIMESTAMPTZ,
  reason                   TEXT,
  created_by_user_id       UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_credit_ledger_membership ON membership_credit_ledger (customer_membership_id, created_at);
CREATE INDEX IF NOT EXISTS membership_credit_ledger_tenant ON membership_credit_ledger (tenant_id);
CREATE INDEX IF NOT EXISTS membership_credit_ledger_reservation ON membership_credit_ledger (reservation_ref) WHERE reservation_ref IS NOT NULL;

-- ── Membership billing attempts / invoices (idempotent; integer cents; split recorded but tax/tips separate) ────────
CREATE TABLE IF NOT EXISTS membership_payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  customer_membership_id   UUID NOT NULL,
  customer_id              UUID NOT NULL,
  kind                     TEXT NOT NULL DEFAULT 'renewal',      -- enrollment | renewal | installment | proration | adjustment
  amount_cents             BIGINT NOT NULL DEFAULT 0,
  tax_cents                BIGINT NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'pending',      -- pending | succeeded | failed | refunded | voided
  processor                TEXT NOT NULL DEFAULT 'recorded',     -- cardpointe | clover | recorded | manual
  processor_ref            TEXT,
  idempotency_key          TEXT NOT NULL,                        -- prevents duplicate charges for one cycle
  attempt_number           INTEGER NOT NULL DEFAULT 1,
  failure_reason           TEXT,
  period_start             TIMESTAMPTZ,
  period_end               TIMESTAMPTZ,
  tech_alloc_cents         BIGINT NOT NULL DEFAULT 0,            -- technician share of the eligible (pre-tax) amount
  owner_alloc_cents        BIGINT NOT NULL DEFAULT 0,            -- salon share of the eligible (pre-tax) amount
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at               TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_payments_idem ON membership_payments (idempotency_key);
CREATE INDEX IF NOT EXISTS membership_payments_membership ON membership_payments (customer_membership_id);
CREATE INDEX IF NOT EXISTS membership_payments_tenant_status ON membership_payments (tenant_id, status);

-- ── Immutable redemption snapshots (a benefit consumed on a ticket; never destroyed) ────────────────────────────────
CREATE TABLE IF NOT EXISTS membership_redemptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  customer_membership_id   UUID NOT NULL,
  ticket_id                UUID NOT NULL,
  service_line_id          UUID,
  benefit_id               UUID,
  service_id               UUID,
  standard_value_cents     BIGINT NOT NULL DEFAULT 0,            -- menu price snapshot
  allocated_value_cents    BIGINT NOT NULL DEFAULT 0,            -- membership-allocated value used for commission basis
  upgrade_charge_cents     BIGINT NOT NULL DEFAULT 0,           -- extra the customer paid to upgrade
  technician_id            UUID,
  commission_basis_snapshot TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_redemptions_membership ON membership_redemptions (customer_membership_id);
CREATE INDEX IF NOT EXISTS membership_redemptions_ticket ON membership_redemptions (ticket_id);
CREATE INDEX IF NOT EXISTS membership_redemptions_tenant ON membership_redemptions (tenant_id);

-- ── Activity feed (immutable events powering the Overview "Membership Activity" panel) ──────────────────────────────
CREATE TABLE IF NOT EXISTS membership_activity (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  customer_membership_id   UUID,
  customer_id              UUID,
  plan_id                  UUID,
  activity_type            TEXT NOT NULL,                        -- purchased | renewed | upgraded | downgraded | paused |
                                                                 -- resumed | expiring | canceled | payment_failed |
                                                                 -- payment_recovered | benefit_redeemed | credit_rolled_over |
                                                                 -- credit_expired | transferred
  customer_name_snapshot   TEXT,
  plan_name_snapshot       TEXT,
  amount_cents             BIGINT,
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta                     JSONB
);
CREATE INDEX IF NOT EXISTS membership_activity_tenant_time ON membership_activity (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS membership_activity_membership ON membership_activity (customer_membership_id);

-- ── Immutable audit log for sensitive membership actions (not editable by ordinary users) ──────────────────────────
CREATE TABLE IF NOT EXISTS membership_audit (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  customer_membership_id   UUID,
  plan_id                  UUID,
  plan_version_id          UUID,
  customer_id              UUID,
  actor_user_id            UUID,
  actor_role               TEXT,
  action                   TEXT NOT NULL,
  prev_state               TEXT,
  new_state                TEXT,
  reason                   TEXT,
  result                   TEXT,
  device                   TEXT,
  session                  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_audit_tenant_time ON membership_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS membership_audit_membership ON membership_audit (customer_membership_id);
