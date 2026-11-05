/**
 * compensation-guarantee.ts — Guaranteed Earnings + Salon Cover Top-Up (spec §6, §7, §19). Pure, integer-cents.
 * The salon promises a minimum; when eligible technician compensation falls short, the salon pays the difference
 * (the "Salon Cover Top-Up"). Tips and supply reimbursements are ALWAYS excluded from the comparison (§6/§7).
 * Nonrecoverable by default — the top-up is never carried forward as technician debt.
 */
import type { Cents } from './compensation.types';
import { computeGuaranteeTopUp, prorateGuarantee } from './compensation-engine';

export type GuaranteePeriod = 'shift' | 'day' | 'week' | 'pay_period' | 'month';
export type ProrationMethod = 'none' | 'by_hours_worked' | 'by_scheduled_hours' | 'by_eligible_days' | 'manual';
export type GuaranteeType = 'nonrecoverable' | 'recoverable_draw' | 'custom';

/** Which earnings categories count toward the guaranteed amount (§7). Tips/supply are never included. */
export interface GuaranteeInclusions {
  serviceCommission: boolean;   // default true
  hourly: boolean;
  salary: boolean;
  retailCommission: boolean;
  bonus: boolean;
  manualAdjustments: boolean;
}

export interface GuaranteePolicy {
  period: GuaranteePeriod;
  guaranteedCents: Cents;
  proration: ProrationMethod;
  type: GuaranteeType;          // default 'nonrecoverable'
  include: GuaranteeInclusions;
  // eligibility (§7)
  requireClockedIn?: boolean;
  minHoursRequired?: number;
  probationExcluded?: boolean;
  effectiveStart?: string;
  effectiveEnd?: string;
}

/** Facts about the technician's period used for eligibility + proration (§7). */
export interface PeriodFacts {
  clockedIn?: boolean;
  hoursWorked?: number;
  eligibleHours?: number;       // worked hours that count toward proration (defaults to hoursWorked)
  scheduledHours?: number;
  eligibleDays?: number;
  scheduledDays?: number;
  isProbation?: boolean;
  managerApprovedException?: boolean;  // overrides ineligibility (§7)
  asOf?: string;                // the period date, for effective-window checks
}

/** Earnings for the period (tips tracked but never count toward the guarantee). */
export interface PeriodEarnings {
  serviceCommissionCents?: Cents;
  hourlyCents?: Cents;
  salaryCents?: Cents;
  retailCommissionCents?: Cents;
  bonusCents?: Cents;
  manualAdjustmentCents?: Cents;
  cardTipCents?: Cents;         // excluded from guarantee
  cashTipCents?: Cents;         // excluded from guarantee
}

export interface GuaranteeResult {
  eligible: boolean;
  reasons: string[];                 // why eligible/ineligible
  eligibleCompensationCents: Cents;  // included categories only; tips/tax excluded
  guaranteedCents: Cents;            // configured
  proratedGuaranteeCents: Cents;     // after proration
  prorationMethod: ProrationMethod;
  prorationNote?: string;            // set when the no-scheduled-data fail-safe applied the full guarantee
  salonCoverTopUpCents: Cents;       // the salon-funded difference (§6)
  tipsCents: Cents;                  // shown separately, kept whole (does not reduce top-up)
  totalBeforeOtherPayrollItemsCents: Cents; // eligible comp + top-up + tips (the technician's period total, §6 examples)
  recoverable: boolean;
}

export function assessEligibility(policy: GuaranteePolicy, facts: PeriodFacts): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (facts.managerApprovedException) { reasons.push('Manager-approved exception'); return { eligible: true, reasons }; }
  let eligible = true;
  if (policy.effectiveStart && facts.asOf && new Date(facts.asOf) < new Date(policy.effectiveStart)) { eligible = false; reasons.push('Before guarantee start date'); }
  if (policy.effectiveEnd && facts.asOf && new Date(facts.asOf) > new Date(policy.effectiveEnd)) { eligible = false; reasons.push('After guarantee end date'); }
  if (policy.requireClockedIn && !facts.clockedIn) { eligible = false; reasons.push('Not clocked in'); }
  if (policy.minHoursRequired != null && (facts.hoursWorked ?? 0) < policy.minHoursRequired) { eligible = false; reasons.push(`Below minimum hours (${facts.hoursWorked ?? 0} < ${policy.minHoursRequired})`); }
  if (policy.probationExcluded && facts.isProbation) { eligible = false; reasons.push('New-employee probation excluded'); }
  if (eligible) reasons.push('Meets eligibility');
  return { eligible, reasons };
}

/** No-scheduled-data fail-safe (Jul 28, 2026): when the proration denominator is unknown or zero, the FULL guarantee
 *  is paid and a note says why — never a silent $0. Eligibility (require_clocked_in / min_hours_required) remains the
 *  lever for withholding a guarantee from someone who didn't work. */
function proratedGuarantee(policy: GuaranteePolicy, facts: PeriodFacts, manualProratedCents?: Cents): { cents: Cents; note?: string } {
  const g = Math.max(0, Math.round(policy.guaranteedCents));
  switch (policy.proration) {
    case 'none': return { cents: g };
    case 'manual': return { cents: Math.max(0, Math.round(manualProratedCents ?? g)) };
    case 'by_hours_worked': {
      const sched = facts.scheduledHours ?? 0;
      if (!Number.isFinite(sched) || sched <= 0) return { cents: g, note: 'Scheduled hours not on record — full guarantee applied, not prorated' };
      return { cents: prorateGuarantee(g, facts.eligibleHours ?? facts.hoursWorked ?? 0, sched) };
    }
    case 'by_scheduled_hours': {
      const sched = facts.scheduledHours ?? 0;
      if (!Number.isFinite(sched) || sched <= 0) return { cents: g, note: 'Scheduled hours not on record — full guarantee applied, not prorated' };
      return { cents: prorateGuarantee(g, sched, sched) }; // full scheduled → 1.0
    }
    case 'by_eligible_days': {
      const sd = facts.scheduledDays ?? 0;
      if (!Number.isFinite(sd) || sd <= 0) return { cents: g, note: 'Scheduled days not on record — full guarantee applied, not prorated' };
      return { cents: Math.round(g * Math.min(1, Math.max(0, (facts.eligibleDays ?? 0) / sd))) };
    }
    default: return { cents: g };
  }
}

/** Compute the guarantee + salon cover top-up for one technician for one period. */
export function computeGuarantee(
  policy: GuaranteePolicy, facts: PeriodFacts, earnings: PeriodEarnings, manualProratedCents?: Cents,
): GuaranteeResult {
  const { eligible, reasons } = assessEligibility(policy, facts);
  const inc = policy.include;
  const eligibleCompensationCents =
      (inc.serviceCommission ? (earnings.serviceCommissionCents ?? 0) : 0)
    + (inc.hourly ? (earnings.hourlyCents ?? 0) : 0)
    + (inc.salary ? (earnings.salaryCents ?? 0) : 0)
    + (inc.retailCommission ? (earnings.retailCommissionCents ?? 0) : 0)
    + (inc.bonus ? (earnings.bonusCents ?? 0) : 0)
    + (inc.manualAdjustments ? (earnings.manualAdjustmentCents ?? 0) : 0);
  // tips NEVER included (§6/§7)
  const tipsCents = (earnings.cardTipCents ?? 0) + (earnings.cashTipCents ?? 0);

  const prorated = eligible ? proratedGuarantee(policy, facts, manualProratedCents) : { cents: 0 as Cents };
  const proratedGuaranteeCents = prorated.cents;
  const salonCoverTopUpCents = eligible ? computeGuaranteeTopUp(proratedGuaranteeCents, eligibleCompensationCents) : 0;

  return {
    eligible, reasons, eligibleCompensationCents,
    guaranteedCents: Math.max(0, Math.round(policy.guaranteedCents)),
    proratedGuaranteeCents, prorationMethod: policy.proration, prorationNote: prorated.note,
    salonCoverTopUpCents, tipsCents,
    totalBeforeOtherPayrollItemsCents: eligibleCompensationCents + salonCoverTopUpCents + tipsCents,
    recoverable: policy.type === 'recoverable_draw',
  };
}

export const DEFAULT_INCLUSIONS: GuaranteeInclusions = {
  serviceCommission: true, hourly: true, salary: true, retailCommission: false, bonus: false, manualAdjustments: false,
};
