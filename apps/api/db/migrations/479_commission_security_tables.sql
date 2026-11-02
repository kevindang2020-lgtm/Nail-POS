-- 479_commission_security_tables.sql — the developer's commission-security tables (commission_change_audit_logs,
-- admin_commission_auth_codes). They were created by an ad-hoc script (scripts/create-commission-security-tables.mjs) in the
-- developer's tree, never by a migration; this makes them part of the schema like everything else.
CREATE TABLE IF NOT EXISTS commission_change_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL,
      branch_id TEXT,
      technician_id TEXT,
      service_id TEXT,
      target_type TEXT NOT NULL DEFAULT 'technician',
      old_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      new_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      requested_by_user_id TEXT NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_by_role TEXT NOT NULL,
      authorized_by_user_id TEXT,
      authorized_by_name TEXT,
      auth_code_used TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_comm_audit_tenant_tech ON commission_change_audit_logs (tenant_id, technician_id);

    CREATE TABLE IF NOT EXISTS admin_commission_auth_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL,
      code_enc TEXT NOT NULL,
      generated_by_user_id TEXT,
      generated_by_name TEXT,
      expires_at TIMESTAMPTZ,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_comm_auth_tenant ON admin_commission_auth_codes (tenant_id);
