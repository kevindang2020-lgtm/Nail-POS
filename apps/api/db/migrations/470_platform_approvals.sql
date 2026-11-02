-- 470_platform_approvals.sql — Constitution 7 §119, §120, §182: maker/checker approval for critical platform actions.
-- A request records WHO asked, WHAT (action + payload, never a secret), WHY, and the permission an approver must hold.
-- The requester can never approve their own request (CHECK + service rule). Requests expire. Whether an action needs
-- approval is a platform policy (platform_settings 'approvals.<action>.required'), off by default, so a single operator
-- is not locked out.
CREATE TABLE IF NOT EXISTS platform_approvals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type          TEXT NOT NULL,
  target_ref           TEXT NULL,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason               TEXT NOT NULL,
  requested_by         UUID NOT NULL,
  required_permission  TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','failed','expired','cancelled')),
  approved_by          UUID NULL,
  decision_note        TEXT NULL,
  decided_at           TIMESTAMPTZ NULL,
  executed_at          TIMESTAMPTZ NULL,
  result               JSONB NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_approvals_separation CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX IF NOT EXISTS idx_platform_approvals_pending ON platform_approvals (status, created_at DESC);
