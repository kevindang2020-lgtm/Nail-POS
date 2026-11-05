// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface OwnerDrawerRow extends DrawerState { branchName: string }

export interface OwnerDrawerSummary { businessDate: string; branches: OwnerDrawerRow[] }

export interface DrawerState {
  branchId: string; registerId: string; businessDate: string;   // registerId: cash-drawer registers (developer, Sep 2026)
  openingFloatCents: number;
  expectedSalesCents: number;   // register cash sales (live)
  refundsCents: number;         // cash refunds paid out (live)
  paidInCents: number;          // cash added mid-shift (paid-in)
  paidOutCents: number;         // cash removed mid-shift (paid-out)
  expectedCashCents: number;    // float + sales - refunds + in - out
  countedCents: number | null;
  varianceCents: number | null;
  cashPaymentCount: number;
  status: DrawerStatus;
  openedAt: string | null; reconciledAt: string | null; notes: string | null;
}

// cash-drawer.dto.ts — types, events, helpers for front-desk cash drawer reconciliation.
export type DrawerStatus = 'open' | 'reconciled' | 'discrepancy' | 'cancelled';
