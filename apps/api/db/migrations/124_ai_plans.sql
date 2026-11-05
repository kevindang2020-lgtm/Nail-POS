-- 124_ai_plans.sql — AI package PLANS (five bundles of the 15 assistant packages).
-- ai_plan_settings: global Super-Admin config per plan — an optional manual price override and an optional discount.
--   With no row (or NULL override), a plan's price defaults to the SUM of its member packages (computed in code).
-- tenant_ai_plan_subscriptions: which plan(s) a tenant is on, with the effective price locked in at subscribe time.
-- Subscribing to a plan also activates its member packages in tenant_ai_subscriptions, so the existing access gate
-- (per package) governs assistant access unchanged. Money is integer cents. Additive only.

CREATE TABLE IF NOT EXISTS ai_plan_settings (
  plan_code             TEXT PRIMARY KEY,
  price_cents_override  INTEGER,                                            -- NULL = use default summed full price
  discount_type         TEXT CHECK (discount_type IN ('percent','flat')),  -- NULL = no discount
  discount_value        INTEGER NOT NULL DEFAULT 0,                         -- percent 0..100 OR flat cents
  active                BOOLEAN NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_ai_plan_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','trialing','cancelled')),
  price_cents     INTEGER NOT NULL DEFAULT 0,    -- effective price at subscribe time
  full_cents      INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plan_code)
);
CREATE INDEX IF NOT EXISTS idx_ai_plan_subs_tenant ON tenant_ai_plan_subscriptions (tenant_id, status);
