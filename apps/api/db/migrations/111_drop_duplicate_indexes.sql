-- 111_drop_duplicate_indexes.sql — removes the redundant byte-identical duplicate indexes found by a
-- schema-wide duplicate-index sweep (companion to 110, which handled the tickets paid_at pair). Each pair below
-- indexes the exact same columns in the same order; a second identical btree only doubles write amplification +
-- storage with zero query benefit — the planner uses either interchangeably. For each pair the redundant copy
-- is dropped and an identical index remains, so query plans are unchanged. None of these index names are
-- referenced in application code (Postgres selects indexes by structure, not name). Additive, idempotent, and
-- ordered last so it cannot reorder or conflict with anything.

-- customers (tenant_id, branch_id, full_name): keep idx_customers_tenant_branch_name; drop the duplicate.
DROP INDEX IF EXISTS idx_customers_tenant_branch_search;

-- payments (tenant_id, branch_id, created_at, method): keep idx_payments_tenant_branch_created_method; drop the duplicate.
DROP INDEX IF EXISTS idx_payments_tenant_branch_created_method2;

-- technician_services (tenant_id, branch_id, technician_id): keep idx_technician_services_tenant_branch_technician; drop the duplicate.
DROP INDEX IF EXISTS idx_technician_services_tenant_branch_tech;

-- tickets (tenant_id, branch_id, status, created_at): keep idx_tickets_tenant_branch_status_created; drop the duplicate.
DROP INDEX IF EXISTS idx_tickets_tenant_branch_status_created2;
