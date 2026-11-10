// system-checks.ts — the shared read-only "Check … System" (extras arc, Nov 9 2026: the SUNMI guides' optional
// "One-click … Health / Integrity / Accuracy Checker" on pages that had none). Each check counts problem rows in the salon's
// own data; nothing is changed. A check that could not run is NOT_TESTED — never a pass.
export const SYSTEM_CHECK_DOMAINS = ['expenses', 'invoices', 'settlements', 'payments', 'discounts', 'catalog', 'inventory', 'technicians', 'memberships'] as const;
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
