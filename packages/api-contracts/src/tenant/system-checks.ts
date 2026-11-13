// system-checks.ts — the shared read-only "Check … System" (extras arc, Nov 9 2026: the SUNMI guides' optional
// "One-click … Health / Integrity / Accuracy Checker" on pages that had none). Each check counts problem rows in the salon's
// own data; nothing is changed. A check that could not run is NOT_TESTED — never a pass.
export const SYSTEM_CHECK_DOMAINS = ['expenses', 'invoices', 'settlements', 'payments', 'discounts', 'catalog', 'inventory', 'technicians', 'memberships',
  'service-flow', 'terminals', 'approvals', 'reports', 'suppliers'] as const;
export type SystemCheckDomain = (typeof SYSTEM_CHECK_DOMAINS)[number];
export type SystemCheckState = 'READY' | 'WARNING' | 'FAILED' | 'NOT_TESTED';
export interface SystemCheckItem { key: string; state: SystemCheckState; /** rows with the problem; null when the check could not run */ count: number | null }
export interface SystemCheckResult {
  domain: SystemCheckDomain;
  overall: 'READY' | 'WARNING' | 'FAILED' | 'NOT_TESTED';
  checkedAt: string;
  /** the branch the counts cover, or null for every branch the person may see */
  branchId: string | null;
  checks: SystemCheckItem[];
}

/** extras Membership Overview 16 · 15 — Reconciliation Drill-Down: the source rows behind one non-zero check (read-only). */
export interface SystemCheckSourceRow {
  membershipId: string;
  /** the member's number and name, for the person who may already see the Membership page */
  memberNumber: string | null;
  customerName: string | null;
  source: 'membership' | 'payment' | 'redemption' | 'ledger_entry' | 'benefit_balance' | 'redemption_vs_ledger' | 'notice';
  sourceId: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  amountCents: number | null;
  at: string | null;
  /** a code from the source row (its status / kind / processor), a credit balance (benefit_balance) or 'redemptions/ledger' counts — never free text */
  detail: string | null;
}
export interface SystemCheckRows {
  domain: SystemCheckDomain;
  key: string;
  checkedAt: string;
  branchId: string | null;
  /** false when this check has no drill-down (or could not run) — rows is then empty, never a guess */
  available: boolean;
  rows: SystemCheckSourceRow[];
  /** more rows exist than were returned */
  truncated: boolean;
  limit: number;
}
