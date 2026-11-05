-- 005_customers.sql — AIPowerSalon POS Customers (§29). Tenant-scoped.

CREATE TABLE IF NOT EXISTS customers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID NOT NULL,
  first_name               TEXT NOT NULL,
  last_name                TEXT NOT NULL,
  full_name                TEXT NOT NULL,
  normalized_phone         TEXT,
  phone_display            TEXT,
  email                    TEXT,
  birthday                 DATE,
  avatar_url               TEXT,
  status                   TEXT NOT NULL DEFAULT 'active',
  marketing_sms_opt_in     BOOLEAN NOT NULL DEFAULT false,
  marketing_email_opt_in   BOOLEAN NOT NULL DEFAULT false,
  preferred_technician_id  UUID,
  notes                    TEXT,
  created_by_user_id       UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at              TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS customer_loyalty_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  branch_id              UUID NOT NULL,
  customer_id            UUID NOT NULL,
  loyalty_tier           TEXT NOT NULL DEFAULT 'Regular',
  points_balance         INTEGER NOT NULL DEFAULT 0,
  total_earned_points    INTEGER NOT NULL DEFAULT 0,
  total_redeemed_points  INTEGER NOT NULL DEFAULT 0,
  vip_since              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_preferences (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID NOT NULL,
  customer_id              UUID NOT NULL,
  preferred_style_notes    TEXT,
  product_preferences_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  favorite_colors_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
  avoid_products_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_allergies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  branch_id         UUID NOT NULL,
  customer_id       UUID NOT NULL,
  allergy_notes     TEXT,
  sensitivity_notes TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_merge_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID NOT NULL,
  source_customer_id  UUID NOT NULL,
  target_customer_id  UUID NOT NULL,
  merged_by_user_id   UUID,
  merge_summary_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch_phone
  ON customers (tenant_id, branch_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch_name
  ON customers (tenant_id, branch_id, full_name);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch_email
  ON customers (tenant_id, branch_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch_status
  ON customers (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_loyalty_tenant_customer
  ON customer_loyalty_profiles (tenant_id, branch_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_customer_paid
  ON tickets (tenant_id, branch_id, customer_id, paid_at);
-- [moved to 029_deferred_indexes.sql] index on 'appointments' (table is created later)
