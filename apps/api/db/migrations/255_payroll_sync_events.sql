-- 175_payroll_sync_events.sql — payroll INTEGRATION sync monitoring (§35). This is the technical sync layer, entirely
-- separate from payroll AMOUNTS (115_payroll). It stores only sync status + safe error metadata for oversight and
-- controlled retry. It deliberately holds NO monetary values, NO payroll/commission/tip amounts, NO provider
-- credentials, and NO tax identifiers (§45). A retry re-attempts the integration send; the idempotency_key prevents
-- duplicate payroll entries. Permanent failures (bad mapping / auth) are not retryable until the config is corrected.
CREATE TABLE IF NOT EXISTS payroll_sync_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users (id) ON DELETE SET NULL,
  provider         TEXT NOT NULL,
  event_type       TEXT NOT NULL
                     CHECK (event_type IN ('worker_provision','hours_export','commission_export','tip_export','batch','reconciliation')),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('synced','pending','processing','failed','retrying','not_configured','not_required')),
  error_code       TEXT,
  error_message    TEXT,
  attempt_count    INT NOT NULL DEFAULT 0,
  max_attempts     INT NOT NULL DEFAULT 5,
  idempotency_key  TEXT NOT NULL,
  external_ref     TEXT,
  last_attempt_at  TIMESTAMPTZ,
  next_retry_at    TIMESTAMPTZ,
  resolution       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payroll_sync_events_idem UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_payroll_sync_events_tenant ON payroll_sync_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_sync_events_status ON payroll_sync_events (status);
CREATE INDEX IF NOT EXISTS idx_payroll_sync_events_user ON payroll_sync_events (user_id);
