-- 065_technician_notifications.sql — tech-app notifications (build doc §4/§28), mirroring customer_notifications.
CREATE TABLE IF NOT EXISTS technician_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  technician_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  reference TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_technician_notifications_list ON technician_notifications (tenant_id, technician_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_technician_notifications_unread ON technician_notifications (tenant_id, technician_id) WHERE read_at IS NULL;
