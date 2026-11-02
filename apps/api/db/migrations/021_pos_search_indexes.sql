-- 021_pos_search_indexes.sql — tenant/branch-first search indexes (§21). Additive only.
CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch_search ON customers (tenant_id, branch_id, full_name);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_start ON appointments (tenant_id, branch_id, start_time);
CREATE INDEX IF NOT EXISTS idx_services_tenant_branch_name ON services (tenant_id, branch_id, name);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch_number ON tickets (tenant_id, branch_id, ticket_number);
CREATE INDEX IF NOT EXISTS idx_technicians_tenant_branch_name ON technicians (tenant_id, branch_id, full_name);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant_branch_number ON receipts (tenant_id, branch_id, receipt_number);
