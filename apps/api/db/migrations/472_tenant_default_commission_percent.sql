-- 432_tenant_default_commission_percent.sql — Tenant default baseline commission percentage
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_commission_percent NUMERIC DEFAULT 50;
