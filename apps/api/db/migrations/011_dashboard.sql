-- 011_dashboard.sql — AIPowerSalon Dashboard support (§27). Tenant/branch-scoped. Idempotent.
-- Most tables exist from earlier migrations; this adds the satisfaction source + the dashboard read indexes.

CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  branch_id   UUID NOT NULL,
  customer_id UUID,
  ticket_id   UUID,
  rating      NUMERIC(2,1) NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_start
  ON appointments (tenant_id, branch_id, start_time);
-- [moved] orphaned index on non-existent 'queue_items' removed; canonical table is indexed by its own migration.
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_status
  ON tickets (tenant_id, branch_id, status);
-- [moved to 029_deferred_indexes.sql] index on 'payments' (table is created later)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers (tenant_id, normalized_phone);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_branch_created
  ON reviews (tenant_id, branch_id, created_at);
