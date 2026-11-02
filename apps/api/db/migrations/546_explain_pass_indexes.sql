-- migrate: no-transaction
-- 546_explain_pass_indexes.sql — BUILD_PLAN Phase 10 (agent E, Constitution 1 §45 / §111 "indexes match real queries").
--
-- The indexes the EXPLAIN pass (apps/api/scripts/db-explain-pass.mjs, docs/DB_EXPLAIN_PASS_2026-10-08.md) found
-- missing: on a seeded database (10 salons, 20,000 payments and 10,000 appointments each) two salon-scoped shapes read
-- and threw away thousands of rows because the closest index did not match them
--   owner dashboard sales per day (payments where tenant + status approved + approved_at in the last 30 days)
--     used (tenant_id, branch_id, created_at, method) and discarded 16,317 rows, 16.9 ms
--   a customer's appointment history (pos_tech_appointments where tenant + customer, newest first)
--     used (tenant_id, appt_date, status) and discarded 9,998 rows, 7.8 ms
-- Both tables are hot write paths on a live salon, so the builds are CONCURRENTLY (this file runs outside a transaction,
-- one statement at a time, and an interrupted build's INVALID index is dropped by the runner before the retry).
-- Names were checked against every other index in pg_indexes (B's 537 tenant-leading set included) by
-- modules/super-admin/src/super-admin-database/database.pgtest.vitest.spec.ts — no duplicate definition.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant_approved_at ON payments (tenant_id, approved_at) WHERE status = 'approved';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_tech_appts_tenant_customer_date ON pos_tech_appointments (tenant_id, customer_id, appt_date DESC) WHERE customer_id IS NOT NULL;
