// loyalty-corrections-core.ts — pure helpers for loyalty calculation-correction detection. No DB. The expected balance
// for a member is a documented, verifiable identity: earned − redeemed. A discrepancy is a real arithmetic inconsistency
// in stored data (not a heuristic). The workflow status is investigate → propose → approve | reject.
export type DiscrepancyType = 'balance_mismatch' | 'redeemed_mismatch' | 'negative_balance';

/** The balance a member SHOULD have from their own aggregates: earned − redeemed (never below zero for display). */
export function expectedBalance(totalEarned: number, totalRedeemed: number): number {
  return Math.trunc(totalEarned) - Math.trunc(totalRedeemed);
}

/** Signed difference expected − actual. Positive ⇒ member is under-credited; negative ⇒ over-credited. */
export function differencePoints(expected: number, actual: number): number {
  return Math.trunc(expected) - Math.trunc(actual);
}

export function correctionBucket(tenantId: string, customerId: string | null, type: DiscrepancyType): string {
  return [tenantId, customerId ?? 'none', type].join('|');
}

export const CORRECTION_FLOW: Record<string, string[]> = {
  detected: ['proposed', 'rejected'],
  proposed: ['approved', 'rejected', 'detected'],
  approved: [], rejected: [],
};
export function canCorrectionTransition(from: string, to: string): boolean {
  return (CORRECTION_FLOW[from] ?? []).includes(to);
}
