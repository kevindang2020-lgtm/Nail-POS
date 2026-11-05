-- 533_tenant_approvals.sql — BUILD_PLAN Phase 9 (Constitution 2, Permissions) — the salon's ONE approvals engine.
--
-- The platform already has maker/checker (470 platform_approvals). Salons had ~12 hand-rolled "approval" flows; the three
-- that move money or publish to customers move onto this engine first: refunds past the salon's threshold, a deal going
-- out for customers, a purchase order. One request row per ask; the requester is never the approver when the policy says
-- so (service rule + CHECK below); a decision is a compare-and-set on `version` (two approvers deciding at once → one
-- decision, one execution); one LIVE request (pending / approved-not-yet-executed) per kind + subject.
--
-- Policies are per salon and per kind, versioned (CAS on version), every change kept in tenant_approval_policy_changes.
-- No row = the defaults in code (Kevin's open decision 3: refund cash $50 / any $200 — today's env values).

CREATE TABLE IF NOT EXISTS tenant_approval_policies (
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind                        TEXT NOT NULL CHECK (kind IN ('refund','void','discount_override','deal_publish','purchase_order','price_override','payout_adjustment','other')),
  enabled                     BOOLEAN NOT NULL DEFAULT true,
  threshold_cents             BIGINT NULL CHECK (threshold_cents IS NULL OR threshold_cents >= 0),
  cash_threshold_cents        BIGINT NULL CHECK (cash_threshold_cents IS NULL OR cash_threshold_cents >= 0),   -- refund: the lower cash limit
  approver_limit_cents        BIGINT NULL CHECK (approver_limit_cents IS NULL OR approver_limit_cents >= 0),   -- an approver without approvals.manage_policies may approve up to this
  require_different_approver  BOOLEAN NOT NULL DEFAULT true,
  expires_after_hours         INT NOT NULL DEFAULT 24 CHECK (expires_after_hours BETWEEN 1 AND 720),
  version                     INT NOT NULL DEFAULT 1,
  updated_by_user_id          UUID NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind)
);

CREATE TABLE IF NOT EXISTS tenant_approval_policy_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,
  version            INT NOT NULL,
  previous_value     JSONB NULL,
  new_value          JSONB NOT NULL,
  actor_user_id      UUID NULL,
  reason             TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tenant_approval_policy_changes ON tenant_approval_policy_changes (tenant_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_approval_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id                   UUID NULL,
  kind                        TEXT NOT NULL CHECK (kind IN ('refund','void','discount_override','deal_publish','purchase_order','price_override','payout_adjustment','other')),
  subject_type                TEXT NOT NULL,
  subject_id                  TEXT NULL,
  title                       TEXT NOT NULL,
  amount_cents                BIGINT NULL CHECK (amount_cents IS NULL OR amount_cents >= 0),
  payload                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason                      TEXT NOT NULL,
  requested_by_user_id        UUID NOT NULL,
  required_permission         TEXT NOT NULL,
  require_different_approver  BOOLEAN NOT NULL DEFAULT true,
  policy_version              INT NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','expired','executed','execution_failed')),
  decided_by_user_id          UUID NULL,
  decision_note               TEXT NULL,
  decided_at                  TIMESTAMPTZ NULL,
  execution_claimed_at        TIMESTAMPTZ NULL,   -- set ONCE by the executing process: at-most-once execution
  executed_at                 TIMESTAMPTZ NULL,
  execution_result            JSONB NULL,
  cancelled_reason            TEXT NULL,
  expires_at                  TIMESTAMPTZ NOT NULL,
  version                     INT NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_approval_separation CHECK (NOT require_different_approver OR decided_by_user_id IS NULL OR decided_by_user_id <> requested_by_user_id)
);
-- one LIVE request per kind + subject (approved stays live until it executes or fails)
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_approval_live ON tenant_approval_requests (tenant_id, kind, subject_type, subject_id)
  WHERE status IN ('pending','approved') AND subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tenant_approval_requests_status ON tenant_approval_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tenant_approval_requests_requester ON tenant_approval_requests (tenant_id, requested_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tenant_approval_requests_expiry ON tenant_approval_requests (expires_at) WHERE status = 'pending';

-- the request's own history (append-only): requested / approved / rejected / cancelled / expired / executed / execution_failed
CREATE TABLE IF NOT EXISTS tenant_approval_request_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id         UUID NOT NULL REFERENCES tenant_approval_requests(id) ON DELETE CASCADE,
  action             TEXT NOT NULL,
  from_status        TEXT NULL,
  to_status          TEXT NOT NULL,
  actor_user_id      UUID NULL,
  note               TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tenant_approval_request_events ON tenant_approval_request_events (tenant_id, request_id, created_at);
CREATE OR REPLACE FUNCTION tenant_approval_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'tenant_approval_request_events is append-only'; END $$;
DROP TRIGGER IF EXISTS tenant_approval_request_events_no_update ON tenant_approval_request_events;
CREATE TRIGGER tenant_approval_request_events_no_update BEFORE UPDATE ON tenant_approval_request_events FOR EACH ROW EXECUTE FUNCTION tenant_approval_events_append_only();
