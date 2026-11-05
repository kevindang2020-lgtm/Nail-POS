-- 178_tenant_locale.sql
-- Optional per-tenant locale. NULL means the tenant inherits the platform default locale (no value is fabricated).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locale text;
CREATE INDEX IF NOT EXISTS idx_tenants_locale ON tenants (locale);
