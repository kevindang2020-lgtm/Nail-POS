-- migrate: no-transaction
-- 712_finance_list_indexes.sql — Deposits & Settlements, AI Deposit Reconciliation and Invoices mandates (Oct 29 2026):
-- the newest-first numbered lists (created_at DESC, id DESC) and the date-basis filters each read one of these.
-- Index-only additions, built CONCURRENTLY so a live salon is never blocked; idempotent.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psettle_tenant_created_id ON payment_settlements (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psettle_tenant_settled ON payment_settlements (tenant_id, settled_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psettle_tenant_ref_lower ON payment_settlements (tenant_id, lower(settlement_id));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prefunds_tenant_created_id ON payment_refunds (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant_processor_txn ON payments (tenant_id, processor_transaction_id) WHERE processor_transaction_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_deposits_tenant_created_id ON bank_deposits (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_deposits_tenant_refnorm ON bank_deposits (tenant_id, reference_normalized) WHERE reference_normalized IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_created_id ON invoices (tenant_id, created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_issue ON invoices (tenant_id, issue_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_due ON invoices (tenant_id, due_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_customer ON invoices (tenant_id, customer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_phone_digits ON invoices (tenant_id, bill_to_phone_digits) WHERE bill_to_phone_digits IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_lines_tenant_invoice ON invoice_lines (tenant_id, invoice_id, position);
