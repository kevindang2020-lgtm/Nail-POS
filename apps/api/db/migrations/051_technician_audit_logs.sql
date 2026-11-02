-- 051_technician_audit_logs.sql — append-only audit trail for technician-app actions (§27).
-- Records WHAT happened (action), WHO (technician_id/user_id), and WHERE (tenant/branch), with non-sensitive metadata
-- only. Never stores passwords, tokens, payment/card data, or private note bodies.
CREATE TABLE IF NOT EXISTS technician_audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  technician_id UUID,
  user_id       UUID,
  action        TEXT NOT NULL,
  ticket_id     UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_audit_tenant_tech_time ON technician_audit_logs (tenant_id, technician_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_audit_ticket ON technician_audit_logs (tenant_id, ticket_id);
