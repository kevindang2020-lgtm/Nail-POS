-- 462_tenant_suspension_reason.sql — Constitution 7 §18: every tenant suspension carries a reason CODE (and a written
-- reason, kept in the audit record). The code is on the tenant row while it is suspended — so billing, security and
-- support can see WHY without reading the audit trail — and is cleared on reactivation.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspension_reason_code TEXT NULL;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_suspension_reason_code_vocab;
ALTER TABLE tenants ADD CONSTRAINT tenants_suspension_reason_code_vocab CHECK (suspension_reason_code IS NULL OR suspension_reason_code IN
  ('BILLING','SECURITY','TERMS','FRAUD','TENANT_REQUEST','PLATFORM_OPERATION','OTHER'));
