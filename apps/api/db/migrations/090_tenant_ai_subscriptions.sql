-- 090_tenant_ai_subscriptions.sql
-- Per-package paid AI subscription for a tenant — the source of truth the AI access gate reads to decide "paid?".
-- One row per (tenant, package_code). Status covers the full spec set; trial/period dates drive trial-expiry and the
-- usage window. Super Admin can grant trials / override limits by writing here.
CREATE TABLE IF NOT EXISTS tenant_ai_subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  package_code              TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'trialing'
                              CHECK (status IN ('active','trialing','past_due','unpaid','cancelled','expired','disabled','suspended')),
  billing_period            TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  price_cents               INTEGER NOT NULL DEFAULT 0,
  currency                  TEXT NOT NULL DEFAULT 'usd',
  trial_starts_at           TIMESTAMPTZ,
  trial_ends_at             TIMESTAMPTZ,
  current_period_starts_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_ends_at    TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  payment_provider          TEXT,
  payment_subscription_id   TEXT,
  payment_customer_id       TEXT,
  last_payment_status       TEXT,
  usage_limit               INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
  overage_enabled           BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, package_code)
);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_subscriptions_tenant ON tenant_ai_subscriptions (tenant_id);
