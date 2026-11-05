-- 582_technician_time_off_workflow.sql — the time-off REQUEST workflow on the table 528 created for the AI
-- scheduling optimizer (Technician Profile package, their 465; mandate §20–§21). One row per request; a technician
-- requests (pending), a manager decides (approved / rejected). Only APPROVED rows remove availability. The 528
-- vocabulary is kept (approved | pending | cancelled) and widened with 'rejected'; `kind` and the decision
-- bookkeeping are added. Additive + idempotent.

ALTER TABLE technician_time_off ADD COLUMN IF NOT EXISTS kind           TEXT NOT NULL DEFAULT 'PERSONAL';   -- VACATION | SICK | PERSONAL | UNAVAILABLE
ALTER TABLE technician_time_off ADD COLUMN IF NOT EXISTS requested_by   TEXT;                               -- user id of the requester (technician or manager)
ALTER TABLE technician_time_off ADD COLUMN IF NOT EXISTS approved_by    UUID;                               -- manager who decided (NULL while pending)
ALTER TABLE technician_time_off ADD COLUMN IF NOT EXISTS decided_at     TIMESTAMPTZ;
ALTER TABLE technician_time_off ADD COLUMN IF NOT EXISTS decision_note  TEXT;

ALTER TABLE technician_time_off DROP CONSTRAINT IF EXISTS chk_time_off_status;
ALTER TABLE technician_time_off ADD CONSTRAINT chk_time_off_status CHECK (status IN ('approved','pending','cancelled','rejected'));
ALTER TABLE technician_time_off DROP CONSTRAINT IF EXISTS chk_time_off_kind;
ALTER TABLE technician_time_off ADD CONSTRAINT chk_time_off_kind CHECK (kind IN ('VACATION','SICK','PERSONAL','UNAVAILABLE'));

CREATE INDEX IF NOT EXISTS idx_technician_time_off_tenant_tech_range
  ON technician_time_off (tenant_id, technician_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_technician_time_off_tenant_status
  ON technician_time_off (tenant_id, status, starts_at);
