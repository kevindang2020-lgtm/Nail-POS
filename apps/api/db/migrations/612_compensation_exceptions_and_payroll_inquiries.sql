-- 612_compensation_exceptions_and_payroll_inquiries.sql — Payroll mandate §195–§198 + §152–§153 (Oct 12 2026, wave 2).
--
--   compensation_exceptions — the FINANCIAL EXCEPTION QUEUE (§197) and the durable half of the compensation recovery
--     queue (§196). A paid ticket whose immutable compensation snapshot is missing (the post-payment snapshot failed —
--     the payment itself stays valid, §195) is a 'missing_snapshot' row the recovery worker retries idempotently
--     (attempts / next_attempt_at / last_error); a chargeback waiting for the owner's decision, a refund against a closed
--     period, an unassigned service line, an unallocated tip and a negative net line are rows the owner resolves or
--     dismisses with a note. One row per (tenant, kind, dedupe_key): re-detection updates the same row, never a second.
--     Status open → retrying → resolved / dismissed (machine COMPENSATION_EXCEPTION, modules/workforce).
--   payroll_inquiries — a technician's question about an earning (§152): she cannot change the entry, she can ask. The
--     manager answers (response — the technician sees it) and may keep a private_note the technician never sees (§153).
-- EXPAND-ONLY, idempotent. Writers: modules/workforce compensation (compensation-recovery.ts) + payroll (payroll-inquiries.ts).
CREATE TABLE IF NOT EXISTS compensation_exceptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  branch_id        UUID,
  kind             TEXT NOT NULL CHECK (kind IN ('missing_snapshot', 'missing_technician', 'unallocated_tip', 'missing_rule',
                                                  'refund_closed_period', 'chargeback_review', 'negative_pay', 'invalid_data')),
  severity         TEXT NOT NULL DEFAULT 'blocking' CHECK (severity IN ('blocking', 'warning')),
  dedupe_key       TEXT NOT NULL,
  ticket_id        UUID,
  period_id        UUID,
  technician_id    UUID,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'retrying', 'resolved', 'dismissed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,
  detail_json      JSONB,
  resolution_note  TEXT,
  resolved_by      UUID,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compensation_exceptions_key ON compensation_exceptions (tenant_id, kind, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_compensation_exceptions_open ON compensation_exceptions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compensation_exceptions_retry ON compensation_exceptions (status, next_attempt_at) WHERE status IN ('open', 'retrying');

CREATE TABLE IF NOT EXISTS payroll_inquiries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  branch_id      UUID,
  technician_id  UUID NOT NULL,
  period_id      UUID,
  subject_type   TEXT NOT NULL DEFAULT 'period' CHECK (subject_type IN ('period', 'ticket', 'adjustment', 'payout', 'other')),
  subject_id     UUID,
  message        TEXT NOT NULL CHECK (char_length(message) BETWEEN 3 AND 1000),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  response       TEXT,
  private_note   TEXT,
  responded_by   UUID,
  responded_at   TIMESTAMPTZ,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);
CREATE INDEX IF NOT EXISTS idx_payroll_inquiries_tenant ON payroll_inquiries (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_inquiries_tech   ON payroll_inquiries (tenant_id, technician_id, created_at DESC);
