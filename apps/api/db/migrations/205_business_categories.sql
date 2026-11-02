-- 176_business_categories.sql
-- Platform-wide business categories (salon/business types) used to classify tenants and drive category defaults.
CREATE TABLE IF NOT EXISTS business_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  icon        text,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bizcat_slug ON business_categories (slug);
CREATE INDEX IF NOT EXISTS idx_bizcat_sort ON business_categories (sort_order, name);
-- At most one platform default category.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bizcat_default ON business_categories (is_default) WHERE is_default = true;
