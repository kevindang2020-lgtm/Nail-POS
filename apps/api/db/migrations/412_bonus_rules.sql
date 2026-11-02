-- 412_bonus_rules.sql — target-based technician bonus rules (spec §17). A rule ties a measurable period metric to a
-- target and an amount; when a technician's measured value meets the target, the bonus is EARNED (recommended). Bonuses
-- are surfaced in the payroll preview as pending lines and require human approval before payout — never auto-paid.
-- target_value is NUMERIC to hold cents (money metrics), counts, or a decimal rating uniformly. amount_cents is integer cents.

CREATE TABLE IF NOT EXISTS bonus_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,                          -- NULL = all branches
  technician_id   UUID,                          -- NULL = applies to all technicians in scope
  metric          TEXT NOT NULL,                 -- service_production | retail_sales | rebooking_count | membership_count | attendance_days | rating_avg | team_goal
  target_value    NUMERIC NOT NULL DEFAULT 0,    -- value to reach to qualify
  amount_cents    BIGINT NOT NULL DEFAULT 0,     -- bonus paid when the target is met
  label           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  effective_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_end   TIMESTAMPTZ,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bonus_rules_lookup ON bonus_rules (tenant_id, status);
