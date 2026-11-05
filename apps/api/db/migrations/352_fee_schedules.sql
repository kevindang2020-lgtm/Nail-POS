-- 326_fee_schedules.sql — versioned processor fee schedules for AI Deposit Reconciliation. Each row is a version;
-- creating a new schedule for the same (tenant, processor) bumps version. Older versions still apply to older
-- settlements via effective_from. Money is integer cents; percentage is basis points (290 = 2.90%). Tenant
-- isolation via tenant_id + tenant-scoped queries. Actual fees stay on payment_settlements.fee_cents (reused).
CREATE TABLE IF NOT EXISTS fee_schedules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  processor_type         TEXT NOT NULL,                 -- fiserv | cardpointe | bolt | clover
  label                  TEXT NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1,
  effective_from         DATE NOT NULL,
  percentage_bps         INTEGER NOT NULL DEFAULT 0,     -- basis points
  per_transaction_cents  INTEGER NOT NULL DEFAULT 0,
  batch_cents            INTEGER NOT NULL DEFAULT 0,
  monthly_cents          INTEGER NOT NULL DEFAULT 0,     -- account fee (not applied per settlement)
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_fee_schedules_tenant ON fee_schedules (tenant_id, processor_type, effective_from DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_schedules_version ON fee_schedules (tenant_id, processor_type, version);
