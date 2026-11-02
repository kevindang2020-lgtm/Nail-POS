-- 004_tech_dashboard.sql — AIPowerSalon Technician mobile dashboard (§18)
-- Tables (technicians, tickets, ticket_service_lines, queue_items, appointments,
-- technician_status_events) already exist from 002_serving.sql + 003_technicians.sql.
-- Only the ticket-by-primary-technician index is new; the rest are IF NOT EXISTS no-ops.

CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_tech_status
  ON tickets (tenant_id, branch_id, primary_technician_id, status);

-- covered by 003 (idempotent re-declare for clarity):
CREATE INDEX IF NOT EXISTS idx_ticket_lines_tenant_branch_tech_status
  ON ticket_service_lines (tenant_id, branch_id, technician_id, status);
-- [moved] orphaned index on non-existent 'queue_items' removed; canonical table is indexed by its own migration.
-- [moved to 029_deferred_indexes.sql] index on 'appointments' (table is created later)
