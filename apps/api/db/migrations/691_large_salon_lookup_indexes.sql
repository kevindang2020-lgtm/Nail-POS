-- migrate: no-transaction
-- 691_large_salon_lookup_indexes.sql — M4 200-technician scale (Oct 24 2026). Measured with EXPLAIN ANALYZE on a
-- multi-tenant fixture (scripts/m4-large-salon-explain.mjs: 60 salons, one with 200 technicians; 772k appointments, 687k queue items, 240k tech-queue
-- tickets, 37k blocked times — PERFORMANCE_REPORT.md "Indexes (M4)"). Every lookup below had only the salon prefix of a
-- (tenant_id, branch_id, …) index to use (the booking reads scope branch as `branch_id = $b OR branch_id IS NULL`), so
-- each one read the salon's whole queue history: 1,800–3,500 buffers, 5–15 ms per call on a busy salon, growing every day.
--   pos_queue_items (tenant_id, appointment_id)            booking reassign / check-in by appointment  12.1 ms → 0.012 ms
--   pos_queue_items (tenant_id, assigned_technician_id, started_at)  queue state "last served today" 18.3 ms → 0.34 ms
--   pos_queue_items (tenant_id, ticket_id)                 service done by ticket                        10.0 ms → 0.022 ms
--   pos_tech_queue_tickets (tenant_id, appointment_id)     booking detail / list page (50 ids)           4.9 ms → 0.054 ms
--   pos_tech_queue_tickets (tenant_id, ticket_id)          service done by ticket                        6.5 ms → 0.010 ms
--   technician_blocked_times (tenant_id, block_date)       per-technician / go check-in day reads        0.11 ms → 0.031 ms
-- Partial (… IS NOT NULL) where the column is optional, so walk-ins without an appointment or ticket cost nothing.
-- Measured and NOT added: a technicians email index — no code path looks a technician up by technicians.email in SQL (the
-- hiring duplicate checks read the salon's roster and global_tech_profiles.email_normalized, already unique-indexed). The
-- branch-scoped blocked-time reads keep 035's (tenant_id, branch_id, technician_id, block_date). CONCURRENTLY: these tables take
-- writes all day, so this file runs outside a transaction, one statement at a time; an interrupted build's INVALID index
-- is dropped by the runner before the retry.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_queue_items_tenant_appointment ON pos_queue_items (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_queue_items_tenant_tech_started ON pos_queue_items (tenant_id, assigned_technician_id, started_at) WHERE assigned_technician_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_queue_items_tenant_ticket ON pos_queue_items (tenant_id, ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_tech_queue_tenant_appointment ON pos_tech_queue_tickets (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_tech_queue_tenant_ticket ON pos_tech_queue_tickets (tenant_id, ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_technician_blocked_times_tenant_date ON technician_blocked_times (tenant_id, block_date);
