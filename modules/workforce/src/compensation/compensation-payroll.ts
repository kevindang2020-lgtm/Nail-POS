/**
 * compensation-payroll.ts — derive a canonical PAYROLL LINE from the immutable snapshot (§14) + guarantee top-up (§6)
 * + approved adjustments (§24). Pure builder + a thin orchestrator that reads the snapshot. This is the single source
 * for payroll numbers — payroll never recomputes commission from tickets (no duplicate math, spec §20). Integer cents.
 *
 * payable = service commission + retail commission + guarantee top-up + tips + adjustments  (the technician's gross for
 * the period before statutory/payroll deductions, matching the §6 "total before other payroll items" examples).
 */
import type { Cents } from './compensation.types';
import { computeGuarantee, type GuaranteePolicy, type PeriodFacts } from './compensation-guarantee';

export interface SnapshotSums {
  techServiceEarningsCents: Cents; cardTipCents: Cents; cashTipCents: Cents; retailCommissionCents: Cents; tickets: number;
  grossServiceCents?: Cents;
  /** net posted/approved ledger adjustments in the window (refund reversals, corrections); absent ⇒ 0. */
  adjustmentsCents?: Cents;
}

export interface PayrollLineBreakdown {
  serviceCommissionCents: Cents;
  retailCommissionCents: Cents;
  cardTipCents: Cents;
  cashTipCents: Cents;
  tipsCents: Cents;
  guaranteeTopUpCents: Cents;
  adjustmentCents: Cents;
  payableCents: Cents;        // gross for the period
  reconciles: boolean;        // payable == sum of its parts
}

/** PURE: assemble the canonical payroll line from snapshot sums + optional guarantee top-up + adjustments. */
export function buildPayrollLine(sums: SnapshotSums, guaranteeTopUpCents: Cents = 0, adjustmentCents: Cents = 0): PayrollLineBreakdown {
  const serviceCommissionCents = Math.max(0, Math.round(sums.techServiceEarningsCents));
  const retailCommissionCents = Math.max(0, Math.round(sums.retailCommissionCents));
  const cardTipCents = Math.max(0, Math.round(sums.cardTipCents));
  const cashTipCents = Math.max(0, Math.round(sums.cashTipCents));
  const tipsCents = cardTipCents + cashTipCents;
  const topUp = Math.max(0, Math.round(guaranteeTopUpCents));
  const adj = Math.round(adjustmentCents);
  const payableCents = serviceCommissionCents + retailCommissionCents + topUp + tipsCents + adj;
  return {
    serviceCommissionCents, retailCommissionCents, cardTipCents, cashTipCents, tipsCents,
    guaranteeTopUpCents: topUp, adjustmentCents: adj, payableCents,
    reconciles: payableCents === serviceCommissionCents + retailCommissionCents + topUp + tipsCents + adj,
  };
}

/** Port the orchestrator needs (CompensationSnapshotRepository in production, a fake in tests). */
export interface PayrollSnapshotPort {
  sumByTechnicianPeriod(tenantId: string, technicianId: string, fromIso: string, toIso: string): Promise<SnapshotSums>;
}

/**
 * Derive a technician's payroll line for a period from the snapshot. Guarantee is computed only when a policy is given;
 * the guarantee compares against the period's eligible compensation (service commission + retail, per the policy's
 * inclusions) with tips ALWAYS excluded (§6). Adjustments are passed in (from the approved adjustment ledger, P-later).
 */
export async function payrollLineFromSnapshot(
  port: PayrollSnapshotPort,
  args: { tenantId: string; technicianId: string; fromIso: string; toIso: string; adjustmentCents?: number; guarantee?: { policy: GuaranteePolicy; facts: PeriodFacts; manualProratedCents?: number } },
): Promise<PayrollLineBreakdown & { tickets: number }> {
  const sums = await port.sumByTechnicianPeriod(args.tenantId, args.technicianId, args.fromIso, args.toIso);
  let topUp = 0;
  if (args.guarantee) {
    const g = computeGuarantee(args.guarantee.policy, args.guarantee.facts, {
      serviceCommissionCents: sums.techServiceEarningsCents, retailCommissionCents: sums.retailCommissionCents,
      cardTipCents: sums.cardTipCents, cashTipCents: sums.cashTipCents,
    }, args.guarantee.manualProratedCents);
    topUp = g.salonCoverTopUpCents;
  }
  const line = buildPayrollLine(sums, topUp, args.adjustmentCents ?? 0);
  return { ...line, tickets: sums.tickets };
}
