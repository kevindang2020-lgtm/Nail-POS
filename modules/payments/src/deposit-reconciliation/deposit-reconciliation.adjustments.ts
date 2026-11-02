// deposit-reconciliation.adjustments.ts — normalizes the EXISTING financial events (payment_refunds, chargebacks,
// compensation_adjustments) into a single reconciliation view of things that change what a bank deposit should
// be. This does NOT create a new refund/chargeback/adjustment system — those already exist; we only read them.
// Refunds and chargebacks REDUCE an expected deposit; compensation adjustments are signed as stored.

export type AdjustmentKind = 'refund' | 'chargeback' | 'adjustment';

export interface ReconAdjustment {
  id: string;
  kind: AdjustmentKind;
  amountCents: number;        // deposit impact: negative reduces the expected deposit
  grossAmountCents: number;   // the raw (absolute) amount from the source record
  currency: string;
  status: string;
  reason: string | null;
  processorType: string | null;
  branchId: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface AdjustmentsKpis {
  refundCount: number; refundCents: number;
  chargebackCount: number; chargebackCents: number;
  adjustmentCount: number; adjustmentNetCents: number;   // signed net of compensation adjustments
  unresolvedCount: number;
  depositImpactCents: number;                             // signed sum of all deposit impacts
}

export interface AdjustmentsState { kpis: AdjustmentsKpis; items: ReconAdjustment[] }

// Resolution per source system's own status vocabulary.
const REFUND_RESOLVED = new Set(['refunded', 'completed', 'settled']);
const CHARGEBACK_RESOLVED = new Set(['won', 'lost', 'refunded', 'expired']);
const ADJUSTMENT_RESOLVED = new Set(['approved', 'applied', 'rejected']);

export function refundResolved(status: string): boolean { return REFUND_RESOLVED.has(status); }
export function chargebackResolved(status: string): boolean { return CHARGEBACK_RESOLVED.has(status); }
export function adjustmentResolved(status: string): boolean { return ADJUSTMENT_RESOLVED.has(status); }

export function buildAdjustmentsState(items: ReconAdjustment[]): AdjustmentsState {
  const refunds = items.filter((i) => i.kind === 'refund');
  const chargebacks = items.filter((i) => i.kind === 'chargeback');
  const adjustments = items.filter((i) => i.kind === 'adjustment');
  const kpis: AdjustmentsKpis = {
    refundCount: refunds.length,
    refundCents: refunds.reduce((a, r) => a + r.grossAmountCents, 0),
    chargebackCount: chargebacks.length,
    chargebackCents: chargebacks.reduce((a, r) => a + r.grossAmountCents, 0),
    adjustmentCount: adjustments.length,
    adjustmentNetCents: adjustments.reduce((a, r) => a + r.amountCents, 0),
    unresolvedCount: items.filter((i) => !i.resolved).length,
    depositImpactCents: items.reduce((a, i) => a + i.amountCents, 0),
  };
  const sorted = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { kpis, items: sorted };
}
