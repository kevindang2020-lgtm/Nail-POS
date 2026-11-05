-- 588_compensation_adjustments_refund_idempotency.sql — merge of the other chat's 471 (Oct 12 2026), Payroll mandate §50/§115
-- (every compensation consumer is idempotent under at-least-once delivery) and §160 (financial uniqueness constraints).
-- Before: a replayed refund (same refund, retried hook) produced a SECOND set of negative ledger rows — commission reversed
-- twice. Now every refund-sourced row carries the refund PAYMENT it belongs to and a partial unique index refuses a
-- duplicate (refund_payment_id, service_line_id, technician_id, category) — the insert is ON CONFLICT DO NOTHING, so a
-- replay is a no-op and history (the first set of rows) is preserved untouched.
-- Also: auto-reversals land as 'posted' (counted in period earnings immediately) unless the tenant opted into review —
-- the vocabulary CHECK widens (Phase 10 helper: NOT VALID, counted, validated; it only widens so nothing can break).
-- EXPAND-ONLY, idempotent. Writers: modules/workforce compensation-snapshot.repository.ts + compensation-adjustments.repository.ts.
ALTER TABLE compensation_adjustments ADD COLUMN IF NOT EXISTS refund_payment_id UUID;

ALTER TABLE compensation_adjustments DROP CONSTRAINT IF EXISTS compensation_adjustments_status_check;
DO $$
BEGIN
  PERFORM schema_apply_check('compensation_adjustments', 'compensation_adjustments_status_check',
    'status IN (''pending'', ''approved'', ''rejected'', ''applied'', ''pending_review'', ''posted'')',
    '588_compensation_adjustments_refund_idempotency.sql');
END $$;

-- technician_id may be NULL for an unassigned line and service_line_id for a ticket-level row; coalesce both so the
-- uniqueness still holds for those rows (NULLs are distinct to a unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_comp_adj_refund_line_tech_cat
  ON compensation_adjustments (tenant_id, refund_payment_id,
                               COALESCE(service_line_id, '00000000-0000-0000-0000-000000000000'::uuid),
                               COALESCE(technician_id, '00000000-0000-0000-0000-000000000000'::uuid), category)
  WHERE refund_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comp_adj_refund ON compensation_adjustments (tenant_id, refund_payment_id);
