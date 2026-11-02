-- 083_account_requests.sql — Apple-compliance account deletion / deactivation requests.
-- These are REQUESTS, not silent hard-deletes: payment, audit, and business records must be retained for legal /
-- financial reasons. A request is recorded and acknowledged; actual removal is an operational step with retention rules.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  user_id       uuid NOT NULL,
  role          text NOT NULL,
  request_type  text NOT NULL DEFAULT 'delete' CHECK (request_type IN ('delete','deactivate')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','processing','completed','rejected','cancelled')),
  reason        text,
  contact_email text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_del_req_user ON account_deletion_requests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_account_del_req_tenant ON account_deletion_requests (tenant_id, status);
