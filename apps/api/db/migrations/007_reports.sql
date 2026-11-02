-- 007_reports.sql — AIPowerSalon POS Reports (§20). Tenant-scoped. Idempotent.

CREATE TABLE IF NOT EXISTS report_exports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  branch_id    UUID NOT NULL,
  user_id      UUID,
  role         TEXT,
  report_key   TEXT NOT NULL,
  format       TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  file_url     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional pre-aggregated daily summaries for large date ranges / many tenants (§20)
CREATE TABLE IF NOT EXISTS tenant_daily_sales_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, summary_date DATE NOT NULL,
  revenue_cents BIGINT NOT NULL DEFAULT 0, refunds_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_daily_booking_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, summary_date DATE NOT NULL,
  bookings INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0, no_show INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_daily_service_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, summary_date DATE NOT NULL,
  service_id UUID NOT NULL, revenue_cents BIGINT NOT NULL DEFAULT 0, service_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_daily_technician_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, summary_date DATE NOT NULL,
  technician_id UUID NOT NULL, revenue_cents BIGINT NOT NULL DEFAULT 0, completed_services INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_daily_customer_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, summary_date DATE NOT NULL,
  new_customers INTEGER NOT NULL DEFAULT 0, returning_customers INTEGER NOT NULL DEFAULT 0, active_customers INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_daily_review_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, branch_id UUID NOT NULL, summary_date DATE NOT NULL,
  rating_sum NUMERIC(10,2) NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_exports_tenant_branch_created
  ON report_exports (tenant_id, branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_paid_at
  ON tickets (tenant_id, branch_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_ticket_lines_tenant_branch_created
  ON ticket_service_lines (tenant_id, branch_id, created_at);
-- [moved to 029_deferred_indexes.sql] index on 'appointments' (table is created later)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch_created
  ON customers (tenant_id, branch_id, created_at);
-- [moved to 029_deferred_indexes.sql] index on 'reviews' (table is created later)
-- [moved to 029_deferred_indexes.sql] index on 'payments' (table is created later)
CREATE INDEX IF NOT EXISTS idx_daily_sales_tenant_branch_date
  ON tenant_daily_sales_summary (tenant_id, branch_id, summary_date);
CREATE INDEX IF NOT EXISTS idx_daily_booking_tenant_branch_date
  ON tenant_daily_booking_summary (tenant_id, branch_id, summary_date);
