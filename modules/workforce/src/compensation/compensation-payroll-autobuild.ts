/**
 * compensation-payroll-autobuild.ts — build a whole payroll period from REAL sales (§20): for each technician with
 * snapshot earnings, derive the canonical line = snapshot sums + resolved guarantee top-up + net approved adjustments
 * from the ledger. Pure orchestration over injected ports — no recomputation from tickets, no second payroll system.
 *
 * Payroll mandate wave 2 (Oct 12 2026): the line also carries the technician's EMPLOYMENT pay type (§38–§44) —
 * hourly pay from the time clock (paid minutes × rate, potential overtime flagged, never paid automatically), salary
 * (prorated by covered days), and a pay type without commission (hourly / salary) does not pay the service commission —
 * plus bonuses (§62) and deductions (§59–§61) split out of the ledger net, and the signed net / non-negative payable
 * (§150). Technicians on an hourly / salary plan with no sales still get a line. All new ports are optional: without them
 * the line is exactly what it was (commission + retail + tips + guarantee + adjustments).
 */
import { buildPayrollLine, type PayrollLineBreakdown, type SnapshotSums } from './compensation-payroll';
import { computeGuarantee, type GuaranteePolicy, type PeriodFacts } from './compensation-guarantee';
import { computeTieredCommission, type TierBand } from './compensation-tiered';
import { componentsFor, computeHourly, salaryForPeriod, type PayPlan, type ShiftInterval } from './compensation-pay-plans';
import { lineNetAndPayable } from '../payroll/payroll-workflow';

export interface AdjustmentBreakdown { bonusCents: number; deductionCents: number; otherCents: number }

export interface AutoBuildPorts {
  /** the salon's (branch's) zone — pay-period boundaries are tenant-local midnights, never UTC (§126). Absent ⇒ UTC. */
  timezone?(tenantId: string, branchId: string | null): Promise<string>;
  /** technicians with snapshot earnings in the window (+ their sums). */
  technicianSums(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<{ technicianId: string; branchId: string | null; sums: SnapshotSums }[]>;
  resolveGuarantee(tenantId: string, technicianId: string, branchId: string | null, asOfIso: string): Promise<GuaranteePolicy | null>;
  netAdjustments(tenantId: string, technicianId: string, fromIso: string, toIso: string, periodId?: string | null): Promise<number>;
  /** §2 tiered plan for a technician (optional — absent ⇒ per-line commission is used unchanged). */
  resolveTierPlan?(tenantId: string, technicianId: string, branchId: string | null, asOfIso: string): Promise<{ mode: 'entire' | 'marginal'; bands: TierBand[] } | null>;
  /** §7 real attendance facts for guarantee eligibility + proration (optional — absent or failing ⇒ the engine's
   *  no-scheduled-data fail-safe applies the full guarantee with a note, never a silent $0). */
  periodFacts?(tenantId: string, technicianId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<PeriodFacts | null>;
  /** wave 2 §44: the technician's pay plan covering the period (null ⇒ commission only). */
  payPlan?(tenantId: string, technicianId: string, branchId: string | null, periodStart: string, periodEnd: string): Promise<PayPlan | null>;
  /** wave 2: technicians on an active hourly / salary / hybrid plan for the period (they get a line without sales). */
  planTechnicians?(tenantId: string, branchId: string | null, periodStart: string, periodEnd: string): Promise<{ technicianId: string; branchId: string | null }[]>;
  /** wave 2: technicians whose only earnings this period are LEDGER entries (a reversal routed here from a locked period,
   *  a bonus, a carried balance) — they still get a line, or the entry would never reach payroll. */
  ledgerTechnicians?(tenantId: string, fromIso: string, toIso: string, periodId: string | null, branchId: string | null): Promise<{ technicianId: string; branchId: string | null }[]>;
  /** wave 2 §39: closed punches + breaks in the window (the time clock is authoritative). */
  timeFacts?(tenantId: string, technicianId: string, fromIso: string, toIso: string): Promise<{ shifts: ShiftInterval[]; breaks: ShiftInterval[]; openShifts: number }>;
  /** wave 2 §62/§59: the counted ledger split into bonus / deduction (positive cents) / everything else. When present it
   *  replaces netAdjustments (other + bonus − deduction == the old net). */
  adjustmentBreakdown?(tenantId: string, technicianId: string, fromIso: string, toIso: string, periodId?: string | null): Promise<AdjustmentBreakdown>;

  // ── §65 batch reads (200-technician mandate: the build must not be N+1) ──────────────────────────────────────────────
  // Each batch method answers ONE fact kind for the whole technician set (set-based SQL, then a Map keyed by technician
  // id) with exactly the per-technician semantics of its single-technician sibling above. Every one is optional: an
  // adapter without it falls back to the per-technician call, so fakes and other callers keep working unchanged. A
  // technician absent from a returned Map means "nothing on record" (null plan / policy / facts, an empty time clock,
  // a zero ledger) — the same answer the single call gives for that technician.
  resolveTierPlans?(tenantId: string, technicians: AutoBuildTechnician[], asOfIso: string): Promise<Map<string, AutobuildTierPlan | null>>;
  payPlans?(tenantId: string, technicians: AutoBuildTechnician[], periodStart: string, periodEnd: string): Promise<Map<string, PayPlan | null>>;
  timeFactsForTechnicians?(tenantId: string, technicianIds: string[], fromIso: string, toIso: string): Promise<Map<string, TimeFacts>>;
  adjustmentBreakdowns?(tenantId: string, technicianIds: string[], fromIso: string, toIso: string, periodId?: string | null): Promise<Map<string, AdjustmentBreakdown>>;
  /** every active guarantee policy is read ONCE for the build and resolved per technician in memory */
  resolveGuarantees?(tenantId: string, technicians: AutoBuildTechnician[], asOfIso: string): Promise<Map<string, GuaranteePolicy | null>>;
  periodFactsForTechnicians?(tenantId: string, technicianIds: string[], fromIso: string, toIso: string, branchId?: string | null): Promise<Map<string, PeriodFacts | null>>;
}

export interface AutoBuildTechnician { technicianId: string; branchId: string | null }
export type AutobuildTierPlan = { mode: 'entire' | 'marginal'; bands: TierBand[] };
export interface TimeFacts { shifts: ShiftInterval[]; breaks: ShiftInterval[]; openShifts: number }
const NO_TIME: TimeFacts = { shifts: [], breaks: [], openShifts: 0 };
const NO_ADJUSTMENTS: AdjustmentBreakdown = { bonusCents: 0, deductionCents: 0, otherCents: 0 };

export interface AutoBuiltLine extends PayrollLineBreakdown {
  technicianId: string; grossSalesCents: number; servicesCount: number;
  hourlyPayCents: number; workedMinutes: number; potentialOvertimeMinutes: number; salaryPayCents: number;
  bonusCents: number; deductionCents: number; netCents: number; reviewRequired: boolean; payType: string;
}

const ZERO_SUMS: SnapshotSums = { techServiceEarningsCents: 0, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, tickets: 0, grossServiceCents: 0 };

/** Build every technician's line for a period. `facts` supplies eligibility/proration data (from attendance/timecards).
 *  fromIso/toIso are the period's half-open INSTANT window (tenant-local midnights); periodStart/periodEnd its civil dates. */
export async function autoBuildPeriod(
  ports: AutoBuildPorts,
  args: { tenantId: string; fromIso: string; toIso: string; branchId?: string | null; factsFor?: (technicianId: string) => PeriodFacts;
    periodId?: string | null; periodStart?: string; periodEnd?: string; timezone?: string },
): Promise<AutoBuiltLine[]> {
  const pStart = args.periodStart ?? String(args.fromIso).slice(0, 10);
  const pEnd = args.periodEnd ?? String(args.toIso).slice(0, 10);
  const techs = await ports.technicianSums(args.tenantId, args.fromIso, args.toIso, args.branchId);
  const all = [...techs];
  if (ports.planTechnicians) {
    for (const p of await ports.planTechnicians(args.tenantId, args.branchId ?? null, pStart, pEnd)) {
      if (!all.some((t) => t.technicianId === p.technicianId)) all.push({ technicianId: p.technicianId, branchId: p.branchId, sums: { ...ZERO_SUMS } });
    }
  }
  if (ports.ledgerTechnicians) {
    for (const p of await ports.ledgerTechnicians(args.tenantId, args.fromIso, args.toIso, args.periodId ?? null, args.branchId ?? null)) {
      if (!all.some((t) => t.technicianId === p.technicianId)) all.push({ technicianId: p.technicianId, branchId: p.branchId, sums: { ...ZERO_SUMS } });
    }
  }
  // §65 prefetch: one read per fact kind for the whole set (when the adapter has the batch method), so the build costs a
  // constant number of round trips however many technicians the salon has. Without a batch method the loop below asks
  // per technician exactly as before.
  const keys: AutoBuildTechnician[] = all.map((t) => ({ technicianId: t.technicianId, branchId: t.branchId }));
  const ids = keys.map((k) => k.technicianId);
  const tierBy = ports.resolveTierPlans ? await ports.resolveTierPlans(args.tenantId, keys, args.toIso) : null;
  const planBy = ports.payPlans ? await ports.payPlans(args.tenantId, keys, pStart, pEnd) : null;
  const adjBy = ports.adjustmentBreakdown && ports.adjustmentBreakdowns ? await ports.adjustmentBreakdowns(args.tenantId, ids, args.fromIso, args.toIso, args.periodId ?? null) : null;
  const policyBy = ports.resolveGuarantees ? await ports.resolveGuarantees(args.tenantId, keys, args.toIso) : null;
  const planOf = async (t: AutoBuildTechnician): Promise<PayPlan | null> =>
    planBy ? (planBy.get(t.technicianId) ?? null) : ports.payPlan ? await ports.payPlan(args.tenantId, t.technicianId, t.branchId, pStart, pEnd) : null;
  // the time clock is read only for technicians on an hourly component (as the per-technician path does)
  let timeBy: Map<string, TimeFacts> | null = null;
  if (ports.timeFacts && ports.timeFactsForTechnicians && planBy) {
    const hourly = keys.filter((k) => { const plan = planBy.get(k.technicianId) ?? null; return !!plan && componentsFor(plan).hourly && plan.hourlyRateCents != null; }).map((k) => k.technicianId);
    timeBy = hourly.length ? await ports.timeFactsForTechnicians(args.tenantId, hourly, args.fromIso, args.toIso) : new Map();
  }
  // attendance facts are needed only for technicians with a guarantee policy and no caller-supplied facts
  const callerFacts = new Map<string, PeriodFacts | undefined>();
  let factsBy: Map<string, PeriodFacts | null> | null = null;
  if (policyBy) {
    const need: string[] = [];
    for (const id of ids) {
      if (!policyBy.get(id)) continue;
      const f = args.factsFor?.(id); callerFacts.set(id, f);
      if (!f) need.push(id);
    }
    if (need.length && ports.periodFacts && ports.periodFactsForTechnicians) {
      // best-effort, exactly like the per-technician call: a facts failure never fails the build (engine fail-safe applies)
      try { factsBy = await ports.periodFactsForTechnicians(args.tenantId, need, pStart, pEnd, args.branchId); } catch { factsBy = new Map(); }
    }
  }

  const out: AutoBuiltLine[] = [];
  for (const t of all) {
    // §2 tiered commission: a technician on a tiered plan earns commission computed from their period production via the
    // band ladder, replacing the per-line snapshot sum. Applied BEFORE the guarantee so the floor sees the tiered amount.
    let sums = t.sums;
    const tier = tierBy ? (tierBy.get(t.technicianId) ?? null) : await ports.resolveTierPlan?.(args.tenantId, t.technicianId, t.branchId, args.toIso);
    if (tier && tier.bands?.length) {
      const tiered = computeTieredCommission(sums.grossServiceCents ?? 0, tier.bands, tier.mode);
      sums = { ...sums, techServiceEarningsCents: tiered.commissionCents };
    }
    // §44 pay type: hourly / salary plans do not pay the service commission; hybrid pays it plus the hourly / salary part.
    const plan = await planOf(t);
    const comp = componentsFor(plan);
    if (!comp.commission) sums = { ...sums, techServiceEarningsCents: 0 };
    let hourlyPayCents = 0, workedMinutes = 0, potentialOvertimeMinutes = 0, salaryPayCents = 0;
    if (plan && comp.hourly && plan.hourlyRateCents != null && ports.timeFacts) {
      const tf = timeBy ? (timeBy.get(t.technicianId) ?? NO_TIME) : await ports.timeFacts(args.tenantId, t.technicianId, args.fromIso, args.toIso);
      const h = computeHourly(tf.shifts, tf.breaks, { hourlyRateCents: plan.hourlyRateCents, breaksPaid: plan.breaksPaid, overtimeWeeklyMinutes: plan.overtimeWeeklyMinutes }, args.timezone || 'UTC');
      hourlyPayCents = h.hourlyPayCents; workedMinutes = h.workedMinutes; potentialOvertimeMinutes = h.potentialOvertimeMinutes;
    }
    if (plan && comp.salary && plan.salaryCentsPerPeriod != null) salaryPayCents = salaryForPeriod(plan.salaryCentsPerPeriod, { start: pStart, end: pEnd }, plan);

    let bonusCents = 0, deductionCents = 0, otherCents: number;
    if (ports.adjustmentBreakdown) {
      const b = adjBy ? (adjBy.get(t.technicianId) ?? NO_ADJUSTMENTS) : await ports.adjustmentBreakdown(args.tenantId, t.technicianId, args.fromIso, args.toIso, args.periodId ?? null);
      bonusCents = b.bonusCents; deductionCents = b.deductionCents; otherCents = b.otherCents;
    } else {
      otherCents = await ports.netAdjustments(args.tenantId, t.technicianId, args.fromIso, args.toIso, args.periodId ?? null);
    }
    let topUp = 0;
    const policy = policyBy ? (policyBy.get(t.technicianId) ?? null) : await ports.resolveGuarantee(args.tenantId, t.technicianId, t.branchId, args.toIso);
    if (policy) {
      // facts precedence: explicit args.factsFor (tests/callers) → the periodFacts port (real attendance) → the
      // legacy vacuous default. The port is best-effort: a facts failure must never fail a payroll build — the
      // engine's fail-safe then pays the full guarantee with a note rather than a silent $0.
      let facts: PeriodFacts | undefined = policyBy ? callerFacts.get(t.technicianId) : args.factsFor?.(t.technicianId);
      if (!facts && factsBy) facts = factsBy.get(t.technicianId) ?? undefined;
      else if (!facts && ports.periodFacts) {
        try { facts = (await ports.periodFacts(args.tenantId, t.technicianId, pStart, pEnd, args.branchId)) ?? undefined; } catch { facts = undefined; }
      }
      if (facts && facts.asOf == null) facts = { ...facts, asOf: args.toIso };
      topUp = computeGuarantee(policy, facts ?? { clockedIn: true }, {
        serviceCommissionCents: sums.techServiceEarningsCents, retailCommissionCents: sums.retailCommissionCents,
        cardTipCents: sums.cardTipCents, cashTipCents: sums.cashTipCents, hourlyCents: hourlyPayCents, salaryCents: salaryPayCents, bonusCents,
      }).salonCoverTopUpCents;
    }
    const base = buildPayrollLine(sums, topUp, otherCents);
    const money = lineNetAndPayable({
      serviceCommissionCents: base.serviceCommissionCents, retailCommissionCents: base.retailCommissionCents, guaranteeTopUpCents: base.guaranteeTopUpCents,
      hourlyPayCents, salaryPayCents, tipsCents: base.tipsCents, bonusCents, adjustmentCents: base.adjustmentCents, deductionCents,
    });
    out.push({
      technicianId: t.technicianId, grossSalesCents: sums.grossServiceCents ?? 0, servicesCount: sums.tickets, ...base,
      hourlyPayCents, workedMinutes, potentialOvertimeMinutes, salaryPayCents, bonusCents, deductionCents,
      netCents: money.netCents, payableCents: money.payableCents, reviewRequired: money.reviewRequired,
      reconciles: money.netCents === base.serviceCommissionCents + base.retailCommissionCents + base.guaranteeTopUpCents + hourlyPayCents + salaryPayCents + base.tipsCents + bonusCents + base.adjustmentCents - deductionCents,
      payType: plan?.payType ?? 'commission',
    });
  }
  return out;
}
