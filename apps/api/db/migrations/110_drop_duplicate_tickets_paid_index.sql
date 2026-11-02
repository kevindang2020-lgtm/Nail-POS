-- 110_drop_duplicate_tickets_paid_index.sql — removes a redundant duplicate index on tickets.
-- 007_reports.sql created idx_tickets_tenant_branch_paid_at (tenant_id, branch_id, paid_at). Later,
-- 017_checkout_payments.sql created idx_tickets_checkout_paid with the SAME column list. Two byte-identical
-- btree indexes cost double write amplification + storage for zero query benefit — the planner uses either one
-- interchangeably. Drop the later duplicate; the original from 007 continues to serve every query that touched
-- it (the checkout/service-done/satisfaction aggregates filter on (tenant_id, branch_id, paid_at)). Additive,
-- idempotent, and safe: an identical index remains, so query plans are unchanged.
DROP INDEX IF EXISTS idx_tickets_checkout_paid;
