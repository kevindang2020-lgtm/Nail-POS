// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type SettlementStatus =
  | 'pending' | 'processing' | 'settled' | 'partially_settled' | 'delayed' | 'failed' | 'held' | 'cancelled' | 'reversed' | 'unknown';

export type ReconciliationStatus =
  | 'not_started' | 'pending' | 'matched' | 'in_review' | 'discrepancy_found' | 'partially_reconciled' | 'reconciled' | 'resolved' | 'escalated' | 'failed';

export type FundingExceptionType = 'delayed_deposit' | 'failed_deposit' | 'large_difference' | 'missing_deposit';

export interface SettlementRow {
  id: string; batchRef: string | null; tenantId: string; tenantName: string | null; branchId: string | null; branchName: string | null;
  processor: string | null; grossCents: number; refundsCents: number; chargebacksCents: number; feesCents: number; adjustmentsCents: number;
  netCents: number; expectedNetCents: number; actualDepositCents: number | null; expectedDepositDate: string | null; actualDepositDate: string | null;
  fundingMasked: string | null; settlementStatus: SettlementStatus; reconciliationStatus: ReconciliationStatus; differenceCents: number | null; transactionCount: number;
}
