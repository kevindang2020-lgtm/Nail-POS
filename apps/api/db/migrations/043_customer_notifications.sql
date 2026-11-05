-- 043_customer_notifications.sql — per-customer notification feed (the Home bell + Notifications screen). Tenant +
-- customer scoped; read state tracked with read_at (NULL = unread). Rows are created by app events (e.g. a booking) and
-- read by the customer app. No cross-tenant access; the customer is always resolved server-side from the session.
CREATE TABLE IF NOT EXISTS customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  reference TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_list ON customer_notifications (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_unread ON customer_notifications (tenant_id, customer_id) WHERE read_at IS NULL;
