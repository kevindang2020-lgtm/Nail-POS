-- 053_technician_skill_change_requests.sql — technician-initiated requests to change their service eligibility (§13).
-- A technician submits a request (add/remove a service); an owner/manager approves or rejects it. On approval the
-- decision mutates technician_services (the real eligibility table). Append-only history; status guarded by CHECK.
CREATE TABLE IF NOT EXISTS technician_skill_change_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,
  technician_id      UUID NOT NULL,
  service_id         UUID NOT NULL,
  request_type       TEXT NOT NULL DEFAULT 'add',
  note               TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id UUID,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_skill_req_type   CHECK (request_type IN ('add','remove')),
  CONSTRAINT chk_skill_req_status CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_skill_req_tenant_status ON technician_skill_change_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_skill_req_tech          ON technician_skill_change_requests (tenant_id, technician_id);
