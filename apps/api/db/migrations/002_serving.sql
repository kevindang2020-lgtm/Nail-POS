-- 002_serving.sql — AIPowerSalon POS Serving (§28)
-- Tenant-scoped. Run after the auth foundation + customers/technicians/services/queue tables exist.

CREATE TABLE IF NOT EXISTS tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID NOT NULL,
  customer_id         UUID NOT NULL,
  queue_item_id       UUID,
  primary_technician_id UUID,
  status              TEXT NOT NULL DEFAULT 'accepted',
  subtotal_cents      INTEGER NOT NULL DEFAULT 0,
  tax_cents           INTEGER NOT NULL DEFAULT 0,
  discount_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  accepted_at         TIMESTAMPTZ,
  serving_started_at  TIMESTAMPTZ,
  service_done_at     TIMESTAMPTZ,
  ready_checkout_at   TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  ticket_number       TEXT,        -- human-friendly number (read by the checkout adapter); nullable until assigned
  station_label       TEXT,        -- station/seat label shown on the customer display
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_service_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  branch_id                UUID NOT NULL,
  ticket_id                UUID NOT NULL,
  service_id               UUID NOT NULL,
  technician_id            UUID,
  service_name_snapshot    TEXT NOT NULL,
  price_cents_snapshot     INTEGER NOT NULL,
  duration_minutes_snapshot INTEGER NOT NULL,
  commission_type_snapshot TEXT,
  commission_value_snapshot INTEGER,
  line_total_cents         INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'assigned',
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  progress_percent         INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_progress_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  branch_id           UUID NOT NULL,
  ticket_id           UUID NOT NULL,
  service_line_id     UUID,
  customer_id         UUID NOT NULL,
  technician_id       UUID,
  event_type          TEXT NOT NULL,
  old_status          TEXT,
  new_status          TEXT NOT NULL,
  metadata_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_status
  ON tickets (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_lines_tenant_branch_status
  ON ticket_service_lines (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_lines_tenant_branch_tech_status
  ON ticket_service_lines (tenant_id, branch_id, technician_id, status);
-- NOTE: the queue index lives with its table — see 026_queue.sql (idx_pos_queue_items_tenant on pos_queue_items).
-- (The old `queue_items` name was never created in this schema; the canonical table is `pos_queue_items`.)
CREATE INDEX IF NOT EXISTS idx_service_progress_ticket
  ON service_progress_events (tenant_id, branch_id, ticket_id, created_at);
