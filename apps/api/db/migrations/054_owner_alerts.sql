-- 054_owner_alerts.sql — owner-facing business alerts / notifications (Owner app Module 6). A salon-wide alert with a
-- severity and a lifecycle status the owner can act on (acknowledge / resolve / dismiss). Append-only creation; both
-- severity and status are guarded by CHECK. This is the table the Owner dashboard "unread" count and the More → Alerts
-- screen read (until now there was no such table, which is why unread was honestly 0).
CREATE TABLE IF NOT EXISTS owner_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID,
  category            TEXT NOT NULL DEFAULT 'general',
  severity            TEXT NOT NULL DEFAULT 'info'  CHECK (severity IN ('info','warning','high','critical')),
  status              TEXT NOT NULL DEFAULT 'new'   CHECK (status IN ('new','acknowledged','in_progress','resolved','dismissed')),
  title               TEXT NOT NULL,
  body                TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_by_user_id UUID,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_tenant_status  ON owner_alerts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_tenant_created ON owner_alerts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_alerts_tenant_branch  ON owner_alerts (tenant_id, branch_id);
