-- 970_device_label_assignment.sql — Device Health 06 (extras round 11): an OPTIONAL device → employee assignment on the salon's
-- device labels (migration 924). Nullable: no device is assigned until a manager picks a person — nothing is assigned
-- automatically. Who / when / by whom are kept on the row; every change (assign, re-assign, clear) is an audit row with
-- before / after (resource 'device_label'), which is the assignment history. Expand-only.
ALTER TABLE device_labels ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users (id);
ALTER TABLE device_labels ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE device_labels ADD COLUMN IF NOT EXISTS assigned_by UUID;
CREATE INDEX IF NOT EXISTS ix_device_labels_assigned_user ON device_labels (tenant_id, assigned_user_id) WHERE assigned_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tc_device_labels__assigned_user_id ON device_labels;
CREATE TRIGGER trg_tc_device_labels__assigned_user_id BEFORE INSERT OR UPDATE OF tenant_id, assigned_user_id ON device_labels
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('users', 'assigned_user_id');
