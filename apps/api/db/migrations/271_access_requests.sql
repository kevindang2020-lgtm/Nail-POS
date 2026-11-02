-- 173_access_requests.sql — access-request approval workflow (§26). A user (or an admin on their behalf) requests a
-- role/scope elevation with a business reason; an approver decides. Temporary grants carry an expiry so access does
-- not persist indefinitely. Every decision is audited (audit_logs). Approval never grants beyond the approver's authority.
CREATE TABLE IF NOT EXISTS access_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID,
  requesting_user_id     UUID NOT NULL,
  prior_role             TEXT,                       -- role at request time (current_role is a reserved word)
  requested_role         TEXT NOT NULL,
  requested_branch_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason                 TEXT NOT NULL,
  requested_duration_days INT,                       -- NULL = permanent
  status                 TEXT NOT NULL DEFAULT 'submitted', -- submitted | under_review | approved | rejected | cancelled | expired
  high_risk              BOOLEAN NOT NULL DEFAULT false,
  approver_user_id       UUID,
  decision_notes         TEXT,
  expires_at             TIMESTAMPTZ,                -- for temporary grants
  decided_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_requests_status_idx ON access_requests (status);
CREATE INDEX IF NOT EXISTS access_requests_tenant_idx ON access_requests (tenant_id);
CREATE INDEX IF NOT EXISTS access_requests_requester_idx ON access_requests (requesting_user_id);
