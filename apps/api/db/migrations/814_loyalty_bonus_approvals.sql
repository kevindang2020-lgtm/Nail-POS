-- 814_loyalty_bonus_approvals.sql — Customer Profile & Global Loyalty Protection guide (Nov 4 2026).
--
-- Salon staff may no longer set or lower a customer's points. A manager asks for a POSITIVE bonus; the salon owner
-- approves it in the Owner App; only then do points move. The request lives on the salon's ONE approvals engine
-- (tenant_approval_requests, kind 'loyalty_bonus'): pending → approved → executed / execution_failed, rejected, expired,
-- cancelled — with its history, audit line and outbox events. When the customer is in the global rewards network the
-- approved bonus debits the salon's prepaid token wallet and credits the customer's global points in one transaction,
-- with one balanced journal entry ('bonus_award'); otherwise it credits the salon's own points program.
--
-- Expand-only: two CHECK lists widened (approval kind, journal entry type).

ALTER TABLE tenant_approval_requests DROP CONSTRAINT IF EXISTS tenant_approval_requests_kind_check;
ALTER TABLE tenant_approval_requests ADD CONSTRAINT tenant_approval_requests_kind_check
  CHECK (kind IN ('refund','void','discount_override','deal_publish','purchase_order','price_override','payout_adjustment','loyalty_bonus','other'));
ALTER TABLE tenant_approval_policies DROP CONSTRAINT IF EXISTS tenant_approval_policies_kind_check;
ALTER TABLE tenant_approval_policies ADD CONSTRAINT tenant_approval_policies_kind_check
  CHECK (kind IN ('refund','void','discount_override','deal_publish','purchase_order','price_override','payout_adjustment','loyalty_bonus','other'));

ALTER TABLE rewards_journal_entries DROP CONSTRAINT IF EXISTS rewards_journal_entries_entry_type_check;
ALTER TABLE rewards_journal_entries ADD CONSTRAINT rewards_journal_entries_entry_type_check CHECK (entry_type IN ('token_purchase_funded', 'earn_allocation',
  'earn_reversal', 'redemption_committed', 'redemption_reversed', 'reimbursement_paid', 'purchase_reversed', 'reimbursement_offset', 'bonus_award'));

-- finding a customer's bonus requests (drawer history) without scanning the salon's whole approval table
CREATE INDEX IF NOT EXISTS ix_tar_loyalty_bonus_subject ON tenant_approval_requests (tenant_id, subject_id, created_at DESC) WHERE kind = 'loyalty_bonus';
