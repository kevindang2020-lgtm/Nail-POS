-- 335_queue_assignment_auto.sql — auto-assignment configuration on the tenant settings row. Auto-assignment is
-- OFF by default (auto_enabled=false); it must be explicitly opted into per branch. The kill-switch is simply
-- setting auto_enabled=false, which takes effect on the next run immediately. Safeguards (confidence floor, per-run
-- cap) live here so they're tenant-tunable and auditable.
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_confidence_floor NUMERIC(5,4) NOT NULL DEFAULT 0.75 CHECK (auto_confidence_floor >= 0 AND auto_confidence_floor <= 1);
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_max_per_run INTEGER NOT NULL DEFAULT 5 CHECK (auto_max_per_run >= 0 AND auto_max_per_run <= 100);
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_updated_by TEXT;
ALTER TABLE queue_assignment_settings ADD COLUMN IF NOT EXISTS auto_updated_at TIMESTAMPTZ;
