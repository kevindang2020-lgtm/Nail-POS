-- 327_reconciliation_exceptions.sql — the reconciliation exception queue. Each row is a case raised from a
-- reconciliation signal (missing deposit, fee difference, duplicate, unmatched record, unresolved adjustment).
-- Cases move through a human-reviewed workflow; resolution requires a note (evidence) and the approve permission
-- — nothing here writes off a discrepancy automatically. Tenant-isolated via tenant_id + scoped queries.
CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  branch_id             UUID,
  kind                  TEXT NOT NULL,        -- missing_deposit | fee_difference | duplicate | unmatched_settlement | unmatched_deposit | adjustment_unresolved | other
  severity              TEXT NOT NULL DEFAULT 'moderate',  -- info | low | moderate | high | critical
  title                 TEXT NOT NULL,
  detail                TEXT,
  amount_cents          BIGINT NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'USD',
  status                TEXT NOT NULL DEFAULT 'open',       -- open | in_review | escalated | resolved | reopened
  source_ref            TEXT,                                -- settlement/deposit id or duplicate key
  assigned_to_user_id   UUID,
  resolution_note       TEXT,
  resolved_by_user_id   UUID,
  resolved_at           TIMESTAMPTZ,
  created_by_user_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_recon_exceptions_tenant_status ON reconciliation_exceptions (tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS ix_recon_exceptions_tenant_created ON reconciliation_exceptions (tenant_id, created_at DESC);
