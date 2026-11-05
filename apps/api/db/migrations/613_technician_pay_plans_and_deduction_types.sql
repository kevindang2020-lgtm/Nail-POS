-- 613_technician_pay_plans_and_deduction_types.sql — Payroll mandate §38–§45 + §59–§61 (Oct 12 2026, wave 2).
--
--   technician_pay_plans — the technician's EMPLOYMENT compensation type (§44), effective-dated and never faked (§43: a
--     salary is not "100% commission", an hourly rate is not "$0 commission"):
--       commission — service commission (the snapshot) only (the default when no plan exists — today's behaviour)
--       hourly     — worked minutes from the time clock × hourly_rate_cents; no service commission
--       salary     — salary_cents_per_period per pay period; no service commission
--       hybrid     — commission PLUS hourly (hourly_rate_cents) and/or salary (salary_cents_per_period)
--     Tips and retail commission are separate components on every type. breaks_paid says whether break minutes are paid
--     (§41 — explicit, never inferred). overtime_weekly_minutes only marks POTENTIAL overtime minutes for review/export
--     (§42 — the salon is not the legal payroll processor; nothing is paid as overtime automatically).
--     §142 for pay plans: an EXCLUDE constraint refuses two active plans for the same technician + branch scope whose
--     effective ranges overlap — the database, not only the service, prevents an ambiguous plan.
--   compensation_deduction_types — the ONLY deductions a salon may apply (§60): a configured type (key + label), turned
--     on per salon, optionally capped per period. A deduction is an adjustment row of category 'deduction' that names its
--     type; the payroll line refuses a deduction larger than the non-tip earnings (§61 tips are never used for deductions).
-- EXPAND-ONLY, idempotent. Writers: modules/workforce compensation (compensation-pay-plans.ts).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS technician_pay_plans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID,
  technician_id            UUID NOT NULL,
  pay_type                 TEXT NOT NULL CHECK (pay_type IN ('commission', 'hourly', 'salary', 'hybrid')),
  hourly_rate_cents        INTEGER CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  salary_cents_per_period  BIGINT  CHECK (salary_cents_per_period IS NULL OR salary_cents_per_period >= 0),
  breaks_paid              BOOLEAN NOT NULL DEFAULT false,
  overtime_weekly_minutes  INTEGER NOT NULL DEFAULT 2400 CHECK (overtime_weekly_minutes > 0),
  effective_start          DATE NOT NULL,
  effective_end            DATE,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  note                     TEXT,
  created_by               UUID,
  updated_by               UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pay_plan_range CHECK (effective_end IS NULL OR effective_end > effective_start),
  CONSTRAINT chk_pay_plan_hourly CHECK (pay_type NOT IN ('hourly') OR hourly_rate_cents IS NOT NULL),
  CONSTRAINT chk_pay_plan_salary CHECK (pay_type NOT IN ('salary') OR salary_cents_per_period IS NOT NULL),
  CONSTRAINT chk_pay_plan_hybrid CHECK (pay_type <> 'hybrid' OR hourly_rate_cents IS NOT NULL OR salary_cents_per_period IS NOT NULL)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_technician_pay_plans_no_overlap') THEN
    ALTER TABLE technician_pay_plans ADD CONSTRAINT ex_technician_pay_plans_no_overlap EXCLUDE USING gist (
      tenant_id WITH =, technician_id WITH =,
      (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
      daterange(effective_start, effective_end, '[)') WITH &&
    ) WHERE (status = 'active');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_technician_pay_plans_tech ON technician_pay_plans (tenant_id, technician_id, effective_start DESC);

CREATE TABLE IF NOT EXISTS compensation_deduction_types (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  key                   TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label                 TEXT NOT NULL,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  max_cents_per_period  BIGINT CHECK (max_cents_per_period IS NULL OR max_cents_per_period > 0),
  created_by            UUID,
  updated_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compensation_deduction_types_key ON compensation_deduction_types (tenant_id, key);
