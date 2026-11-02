-- 399_technician_timecard_adjustments.sql
-- Manager corrections to a technician's timecard (a punch = a row in technician_shifts). We NEVER silently overwrite
-- history: each correction is recorded here with the ORIGINAL value, the NEW value, a required reason, and who made it.
-- The shift row is then updated to the corrected value, but this table is the permanent, append-only adjustment trail.
CREATE TABLE IF NOT EXISTS technician_timecard_adjustments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  shift_id      UUID NOT NULL,
  technician_id UUID NOT NULL,
  field         TEXT NOT NULL,                 -- 'start_time' | 'end_time'
  original_value TIMESTAMPTZ,                  -- value before the correction (may be NULL — e.g. a missed clock-out)
  new_value     TIMESTAMPTZ,                   -- corrected value
  reason        TEXT NOT NULL,                 -- required — a correction with no reason is rejected
  adjusted_by   UUID NOT NULL,                 -- the manager who made the correction
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tc_adjustments_tenant_shift
  ON technician_timecard_adjustments (tenant_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_tc_adjustments_tenant_tech
  ON technician_timecard_adjustments (tenant_id, technician_id, created_at);
