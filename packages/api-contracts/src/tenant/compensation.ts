// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

/**
 * compensation-tiered.ts — tiered commission by production volume (spec §2). A technician's percentage depends on how
 * much service production they generated over a period, so — unlike percent/fixed rules — this is computed at payroll
 * aggregation time from the period's total, NOT per line. Two DISTINCT methods the spec is explicit about not confusing:
 *   • entire-period: the band the total lands in sets ONE rate applied to the WHOLE production.
 *   • marginal:      each band's rate applies only to the portion of production within that band (like tax brackets).
 * Money is integer cents; percentages are 0..100. Pure + deterministic.
 */
export interface TierBand {
  /** inclusive upper bound of this band in cents; null = the top band (no upper bound). */
  uptoCents: number | null;
  /** technician percentage (0..100) for this band. */
  ratePercent: number;
}

export type RetailMethod = 'none' | 'percent' | 'fixed';

export interface RetailPolicy { method: RetailMethod; value: number }

/**
 * compensation-bonus.ts — target-based technician bonuses (spec §17). A bonus rule ties a measurable period METRIC
 * (service production, retail sales, rebooking count, membership sales, attendance, rating, or a team/branch goal) to a
 * TARGET and an AMOUNT: when the technician's measured value meets the target, the bonus is earned. Evaluation is pure +
 * deterministic and returns the metric value + qualified flag so a human can review it — the system RECOMMENDS bonuses;
 * it never auto-pays them (§17). Payroll surfaces earned bonuses as pending lines for approval before the period closes.
 * Money is integer cents. This is the common "hit N → earn $X" bonus; per-unit / tiered / percent bonuses are follow-ons.
 */
export type BonusMetric =
  | 'service_production' | 'retail_sales' | 'rebooking_count' | 'membership_count'
  | 'attendance_days' | 'rating_avg' | 'team_goal';

export interface BonusRuleRow { id: string; technicianId: string | null; branchId: string | null; metric: BonusMetric; target: number; amountCents: number; label: string | null; status: string; effectiveStart: string; createdAt: string }

export interface EarnedBonus {
  label: string;
  metric: BonusMetric;
  qualified: boolean;
  earnedCents: number;
  metricValue: number;
  target: number;
}

export interface BonusPreview { technicianId: string; facts: BonusFacts; bonuses: EarnedBonus[]; totalEarnedCents: number }

export interface PeriodBonusTech { technicianId: string; bonuses: EarnedBonus[]; totalEarnedCents: number }

export interface PeriodBonusReview { periodId: string; technicians: PeriodBonusTech[]; grandTotalCents: number }

/**
 * compensation-compliance.ts — worker-classification wage-compliance checks (spec §18). Given a technician's owner-set
 * classification, their computed period pay, and hours, this SURFACES exceptions for human review — it never changes pay,
 * never auto-tops-up wages, and never auto-classifies anyone. Wage-and-hour rules (minimum wage, overtime) apply to
 * EMPLOYEES only; contractors and booth renters are, by their classification, outside wage-employee rules, so no wage
 * flags are raised for them. The applicable minimum wage and overtime threshold are inputs the tenant supplies (they vary
 * by jurisdiction); a flag means "review before finalizing — you or your advisors decide", not a legal determination.
 * Money is integer cents.
 */
export type WorkerClassification = 'employee' | 'contractor' | 'booth_renter';

export interface ClassificationRow { technicianId: string; classification: WorkerClassification; updatedAt: string }

export interface WageConfig { minHourlyWageCents: number; overtimeThresholdHours: number }

export interface ComplianceFlag {
  code: 'below_minimum_wage' | 'overtime_hours';
  message: string;
  effectiveHourlyCents?: number;
  shortfallCents?: number;
  overtimeHours?: number;
}

export interface CompliancePreview { technicianId: string; classification: WorkerClassification; classificationSet: boolean; wageConfig: WageConfig; flags: ComplianceFlag[] }

export interface PeriodComplianceRow { technicianId: string; technicianName: string | null; classification: WorkerClassification; payableCents: number; hoursWorked: number; flags: ComplianceFlag[] }

/** Measured values for a technician over the pay period. Missing entries are treated as 0 (not qualified). */
export interface BonusFacts {
  serviceProductionCents?: number;
  retailSalesCents?: number;
  rebookingCount?: number;
  membershipCount?: number;
  attendanceDays?: number;
  ratingAvg?: number;
  teamGoalValue?: number;
}

// ── Manual tip allocation (POST /pos/tickets/:id/tip-allocation, tips.adjust) — PAY merge Oct 12 2026 (Payroll mandate
//    §22–§28). Σ tipCents must equal the ticket tip; on a PAID ticket the change lands as posted tip_correction rows in the
//    adjustments ledger (the snapshot is never edited). Money = integer cents.
export interface TipAllocationRequest { allocations: { technicianId: string; tipCents: number }[]; reason?: string }
export interface TipAllocationResult { ok: true; ticketId: string; tipCents: number; allocations: { technicianId: string; tipCents: number }[]; corrections: number }
