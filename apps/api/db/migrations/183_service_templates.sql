-- 183_service_templates.sql — platform-level service TEMPLATE catalog (Super Admin › Catalog Management › Service
-- Templates). These are optional master templates tenants can COPY into their own catalogs; they never overwrite a
-- tenant's custom service. Distinct from tenant `services`/`service_categories`. Money is integer cents (BIGINT).

CREATE TABLE IF NOT EXISTS service_template_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  icon_key      text,
  display_order int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active',        -- active|archived
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  category_code             text REFERENCES service_template_categories (code) ON DELETE SET NULL,
  description               text,
  suggested_duration_minutes int NOT NULL DEFAULT 0,
  suggested_price_min_cents bigint NOT NULL DEFAULT 0,
  suggested_price_max_cents bigint NOT NULL DEFAULT 0,
  tax_setting               text NOT NULL DEFAULT 'taxable',   -- taxable|non_taxable
  commission_eligible       boolean NOT NULL DEFAULT true,
  status                    text NOT NULL DEFAULT 'draft',     -- draft|published|retired
  version                   int NOT NULL DEFAULT 1,
  version_label             text NOT NULL DEFAULT 'v1.0',      -- display label (e.g. 'v2.3')
  is_customizable           boolean NOT NULL DEFAULT true,     -- tenants may customize a copied template
  display_order             int NOT NULL DEFAULT 0,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_templates_category ON service_templates (category_code);
CREATE INDEX IF NOT EXISTS idx_service_templates_status ON service_templates (status);

-- Optional add-ons offered with a template (e.g. French Tip). Money in cents.
CREATE TABLE IF NOT EXISTS service_template_addons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES service_templates (id) ON DELETE CASCADE,
  name          text NOT NULL,
  price_cents   bigint NOT NULL DEFAULT 0,
  display_order int NOT NULL DEFAULT 0,
  UNIQUE (template_id, name)
);

-- Required resources for a template (e.g. Nail Tech x1, Station x1).
CREATE TABLE IF NOT EXISTS service_template_resources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES service_templates (id) ON DELETE CASCADE,
  resource_label text NOT NULL,
  quantity       int NOT NULL DEFAULT 1,
  display_order  int NOT NULL DEFAULT 0
);

-- Immutable version snapshots + change log.
CREATE TABLE IF NOT EXISTS service_template_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES service_templates (id) ON DELETE CASCADE,
  version_number int NOT NULL,
  version_label  text,
  snapshot       jsonb,
  change_reason  text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

-- Which tenants have copied a template (active tenant usage) + whether they've customized their copy.
CREATE TABLE IF NOT EXISTS service_template_deployments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES service_templates (id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  copied_at    timestamptz NOT NULL DEFAULT now(),
  customizable boolean NOT NULL DEFAULT true,
  customized   boolean NOT NULL DEFAULT false,
  UNIQUE (template_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_service_template_deployments_tenant ON service_template_deployments (tenant_id);
