-- 127_customer_privacy_requests.sql
-- Customer privacy-request workflow for Super Admin Customer Data Oversight (§27). Tracks access / correction / export /
-- deletion / anonymization / restriction / consent-withdrawal / marketing-opt-out requests through their lifecycle with a
-- due date and an append-only action history. 'overdue' is DERIVED (non-terminal + due_at < now), not stored.
CREATE TABLE IF NOT EXISTS customer_privacy_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  customer_id          UUID,
  request_type         TEXT NOT NULL
    CHECK (request_type IN ('access','correct','export','delete','anonymize','restrict','withdraw_consent','opt_out_marketing')),
  status               TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','identity_verification_required','verified','in_review','tenant_action_required','processing','completed','rejected','cancelled')),
  requester_name       TEXT,
  requester_contact    TEXT,
  scope                TEXT,
  legal_basis          TEXT,
  assigned_to_user_id  UUID,
  internal_notes       TEXT,
  customer_notes       TEXT,
  action_history       JSONB NOT NULL DEFAULT '[]'::jsonb,
  due_at               TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_by_user_id   UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_tenant_status ON customer_privacy_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status_due ON customer_privacy_requests (status, due_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_customer ON customer_privacy_requests (customer_id);
