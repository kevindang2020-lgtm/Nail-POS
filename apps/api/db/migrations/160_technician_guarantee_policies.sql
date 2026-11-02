-- 160_technician_guarantee_policies.sql — per-technician (or branch/tenant default) Guaranteed-Earnings policy (§6–§8).
-- Resolved most-specific-first AS-OF the period date so historical periods keep their policy (§5). Effective-dated +
-- versioned. Money is integer cents. Tenant/branch scoped; no rows seeded.
CREATE TABLE IF NOT EXISTS technician_guarantee_policies (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL,
  branch_id                  UUID,             -- null = all branches
  technician_id              UUID,             -- null = branch/tenant default
  period                     TEXT NOT NULL DEFAULT 'day'
                             CHECK (period IN ('shift','day','week','pay_period','month')),
  guaranteed_cents           BIGINT NOT NULL DEFAULT 0,
  proration                  TEXT NOT NULL DEFAULT 'none'
                             CHECK (proration IN ('none','by_hours_worked','by_scheduled_hours','by_eligible_days','manual')),
  type                       TEXT NOT NULL DEFAULT 'nonrecoverable'
                             CHECK (type IN ('nonrecoverable','recoverable_draw','custom')),
  include_service_commission BOOLEAN NOT NULL DEFAULT true,
  include_hourly             BOOLEAN NOT NULL DEFAULT true,
  include_salary             BOOLEAN NOT NULL DEFAULT true,
  include_retail             BOOLEAN NOT NULL DEFAULT false,
  include_bonus              BOOLEAN NOT NULL DEFAULT false,
  include_manual             BOOLEAN NOT NULL DEFAULT false,
  require_clocked_in         BOOLEAN NOT NULL DEFAULT false,
  min_hours_required         NUMERIC(6,2),
  probation_excluded         BOOLEAN NOT NULL DEFAULT false,
  effective_start            TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_end              TIMESTAMPTZ,
  version                    INTEGER NOT NULL DEFAULT 1,
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by                 UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guar_pol_tenant_tech ON technician_guarantee_policies (tenant_id, technician_id, effective_start DESC);
CREATE INDEX IF NOT EXISTS idx_guar_pol_tenant      ON technician_guarantee_policies (tenant_id, status, effective_start DESC);
