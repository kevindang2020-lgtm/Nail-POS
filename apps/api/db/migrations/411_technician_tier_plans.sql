-- 411_technician_tier_plans.sql — per-technician tiered commission plans (spec §2). Tiered commission depends on a
-- technician's total production over a period, so it can't be a per-line rule — it's applied at payroll aggregation
-- from the period total. A plan is a band ladder (bands_json = [{uptoCents, ratePercent}] ascending, top band open-ended)
-- plus the method: 'entire' (the band the total lands in rates the whole production) or 'marginal' (bracketed). Money is
-- integer cents. When a technician has an active plan, payroll uses it INSTEAD of summing their per-line commission
-- snapshots for that period; technicians without a plan are unaffected.

CREATE TABLE IF NOT EXISTS technician_tier_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,                          -- NULL = all branches
  technician_id   UUID NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'entire' CHECK (mode IN ('entire','marginal')),
  bands_json      JSONB NOT NULL DEFAULT '[]',    -- [{ "uptoCents": <int|null>, "ratePercent": <0..100> }]
  basis           TEXT NOT NULL DEFAULT 'service_production',  -- what production drives the tier
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  effective_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_end   TIMESTAMPTZ,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_tier_plans_lookup ON technician_tier_plans (tenant_id, technician_id, status);
