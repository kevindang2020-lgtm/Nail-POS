// compensation-payroll-autobuild.vitest.spec.ts — §20 auto-build a period from sales: snapshot + resolved guarantee +
// ledger net. Plus guarantee policy resolution (most-specific, as-of). DB-free via fake ports.
import { describe, it, expect } from 'vitest';
import { autoBuildPeriod, type AutoBuildPorts } from './compensation-payroll-autobuild';
import { resolveGuaranteeRow, rowToPolicy, type GuaranteePolicyRow } from './compensation-guarantee.repository';
import { DEFAULT_INCLUSIONS, type GuaranteePolicy } from './compensation-guarantee';

const weeklyGuarantee: GuaranteePolicy = { period: 'week', guaranteedCents: 100000, proration: 'none', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS };

describe('payroll period auto-build (§20)', () => {
  it('derives each technician line = snapshot + guarantee top-up + ledger net', async () => {
    const ports: AutoBuildPorts = {
      technicianSums: async () => [
        { technicianId: 'a', branchId: 'b1', sums: { techServiceEarningsCents: 87000, cardTipCents: 32500, cashTipCents: 0, retailCommissionCents: 0, tickets: 40 } },
        { technicianId: 'b', branchId: 'b1', sums: { techServiceEarningsCents: 120000, cardTipCents: 10000, cashTipCents: 0, retailCommissionCents: 0, tickets: 55 } },
      ],
      resolveGuarantee: async (_t, tech) => (tech === 'a' ? weeklyGuarantee : null), // only A has a guarantee
      netAdjustments: async (_t, tech) => (tech === 'b' ? -5000 : 0),                 // B had a refund reversal
    };
    const lines = await autoBuildPeriod(ports, { tenantId: 't1', fromIso: '2026-06-20', toIso: '2026-06-26' });
    const a = lines.find((l) => l.technicianId === 'a')!;
    const b = lines.find((l) => l.technicianId === 'b')!;
    // A: weekly $1000 vs $870 → $130 top-up; payable 870+130+325 tips = 1325
    expect(a.guaranteeTopUpCents).toBe(13000);
    expect(a.payableCents).toBe(132500);
    // B: no guarantee, net -50 adjustment; payable 1200 + 100 tips - 50 = 1250
    expect(b.guaranteeTopUpCents).toBe(0);
    expect(b.adjustmentCents).toBe(-5000);
    expect(b.payableCents).toBe(125000);
    expect(a.reconciles && b.reconciles).toBe(true);
  });
});

describe('tiered commission at payroll (§2)', () => {
  const bands = [{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: 600000, ratePercent: 55 }, { uptoCents: null, ratePercent: 60 }];
  const floor280: GuaranteePolicy = { period: 'week', guaranteedCents: 280000, proration: 'none', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS };
  const ports = (over: Partial<AutoBuildPorts> = {}): AutoBuildPorts => ({
    technicianSums: async () => [{ technicianId: 'a', branchId: 'b1', sums: { techServiceEarningsCents: 300000, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, tickets: 20, grossServiceCents: 500000 } }],
    resolveGuarantee: async () => null,
    netAdjustments: async () => 0,
    ...over,
  });

  it('uses the per-line commission sum when there is no tiered plan', async () => {
    const [a] = await autoBuildPeriod(ports(), { tenantId: 't1', fromIso: '2026-06-01', toIso: '2026-06-30' });
    expect(a.serviceCommissionCents).toBe(300000); // unchanged per-line sum
  });

  it('replaces service commission with the entire-period tiered result from production', async () => {
    const [a] = await autoBuildPeriod(ports({ resolveTierPlan: async () => ({ mode: 'entire', bands }) }), { tenantId: 't1', fromIso: '2026-06-01', toIso: '2026-06-30' });
    expect(a.serviceCommissionCents).toBe(275000); // $5000 @ band 2 (55%), replacing the 300000 sum
    expect(a.payableCents).toBe(275000);
  });

  it('floors the guarantee against the TIERED amount (275000 < 280000 floor → 5000 top-up, not 0)', async () => {
    const [a] = await autoBuildPeriod(ports({ resolveTierPlan: async () => ({ mode: 'entire', bands }), resolveGuarantee: async () => floor280 }), { tenantId: 't1', fromIso: '2026-06-01', toIso: '2026-06-30' });
    expect(a.serviceCommissionCents).toBe(275000);
    expect(a.guaranteeTopUpCents).toBe(5000); // proves the floor saw 275000 (tiered), not 300000 (per-line)
    expect(a.payableCents).toBe(280000);
  });
});

describe('guarantee policy resolution (§5/§6)', () => {
  const R = (over: Partial<GuaranteePolicyRow>): GuaranteePolicyRow => ({ technician_id: null, branch_id: null, period: 'day', guaranteed_cents: 18000, proration: 'none', type: 'nonrecoverable', include_service_commission: true, include_hourly: true, include_salary: true, include_retail: false, include_bonus: false, include_manual: false, require_clocked_in: false, min_hours_required: null, probation_excluded: false, effective_start: '2026-01-01', effective_end: null, version: 1, ...over });

  it('technician-specific beats branch default beats tenant default', () => {
    const rows = [R({ guaranteed_cents: 10000 }), R({ branch_id: 'b1', guaranteed_cents: 12000 }), R({ technician_id: 'tech1', guaranteed_cents: 15000 })];
    expect(resolveGuaranteeRow(rows, 'tech1', 'b1', '2026-06-26')!.guaranteed_cents).toBe(15000);
    expect(resolveGuaranteeRow(rows, 'tech2', 'b1', '2026-06-26')!.guaranteed_cents).toBe(12000);
    expect(resolveGuaranteeRow(rows, 'tech2', 'b9', '2026-06-26')!.guaranteed_cents).toBe(10000);
  });

  it('respects effective dates (as-of)', () => {
    const rows = [R({ technician_id: 'tech1', guaranteed_cents: 18000, effective_start: '2026-06-01' })];
    expect(resolveGuaranteeRow(rows, 'tech1', 'b1', '2026-05-01')).toBeNull(); // before start
    expect(resolveGuaranteeRow(rows, 'tech1', 'b1', '2026-06-26')!.guaranteed_cents).toBe(18000);
  });

  it('rowToPolicy maps inclusions + eligibility', () => {
    const pol = rowToPolicy(R({ technician_id: 'tech1', include_retail: true, require_clocked_in: true, min_hours_required: 4 }));
    expect(pol.include.retailCommission).toBe(true);
    expect(pol.requireClockedIn).toBe(true);
    expect(pol.minHoursRequired).toBe(4);
  });
});

describe('guarantee facts at auto-build (§7) — real attendance flows; failure falls back safely (Jul 28, 2026)', () => {
  const sums = { techServiceEarningsCents: 5000, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, tickets: 3 };
  const dayProrated: GuaranteePolicy = { period: 'week', guaranteedCents: 100000, proration: 'by_eligible_days', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS };
  const base = (over: Partial<AutoBuildPorts> = {}): AutoBuildPorts => ({
    technicianSums: async () => [{ technicianId: 'a', branchId: 'b1', sums }],
    resolveGuarantee: async () => dayProrated,
    netAdjustments: async () => 0,
    ...over,
  });

  it('periodFacts port supplies real attendance → guarantee prorates on it (3 of 6 days = $500; top-up 500-50)', async () => {
    const seen: unknown[] = [];
    const [a] = await autoBuildPeriod(base({
      periodFacts: async (t, tech, from, to, branch) => { seen.push([t, tech, from, to, branch]); return { clockedIn: true, hoursWorked: 20, eligibleHours: 20, eligibleDays: 3, scheduledDays: 6 }; },
    }), { tenantId: 't1', fromIso: '2026-07-01', toIso: '2026-07-07', branchId: 'b9' });
    expect(seen).toEqual([['t1', 'a', '2026-07-01', '2026-07-07', 'b9']]); // period scope, not the tech row's branch
    expect(a.guaranteeTopUpCents).toBe(45000); // prorated 50000 − earned 5000
  });

  it('no facts source at all → the fail-safe pays the FULL guarantee (never a silent $0 for a prorated policy)', async () => {
    const [a] = await autoBuildPeriod(base(), { tenantId: 't1', fromIso: '2026-07-01', toIso: '2026-07-07' });
    expect(a.guaranteeTopUpCents).toBe(95000); // full 100000 − 5000
  });

  it('a throwing periodFacts port never fails the build; the fail-safe applies', async () => {
    const [a] = await autoBuildPeriod(base({ periodFacts: async () => { throw new Error('shifts table unavailable'); } }),
      { tenantId: 't1', fromIso: '2026-07-01', toIso: '2026-07-07' });
    expect(a.guaranteeTopUpCents).toBe(95000);
  });

  it('args.factsFor (explicit caller facts) wins over the port', async () => {
    const [a] = await autoBuildPeriod(base({ periodFacts: async () => ({ clockedIn: true, eligibleDays: 1, scheduledDays: 10 }) }),
      { tenantId: 't1', fromIso: '2026-07-01', toIso: '2026-07-07', factsFor: () => ({ clockedIn: true, eligibleDays: 6, scheduledDays: 6 }) });
    expect(a.guaranteeTopUpCents).toBe(95000); // factsFor's 6/6 → full 100000 − 5000
  });

  it('real facts drive eligibility too: min_hours_required with low worked hours → no top-up', async () => {
    const gated: GuaranteePolicy = { ...dayProrated, proration: 'none', minHoursRequired: 10 };
    const [a] = await autoBuildPeriod(base({
      resolveGuarantee: async () => gated,
      periodFacts: async () => ({ clockedIn: true, hoursWorked: 2, eligibleHours: 2, eligibleDays: 1, scheduledDays: 1 }),
    }), { tenantId: 't1', fromIso: '2026-07-01', toIso: '2026-07-07' });
    expect(a.guaranteeTopUpCents).toBe(0);
  });
});

describe('§65 batch ports (200-technician mandate: the build is not N+1)', () => {
  const sums = (gross: number) => ({ techServiceEarningsCents: 30_000, cardTipCents: 1_000, cashTipCents: 0, retailCommissionCents: 0, tickets: 3, grossServiceCents: gross });
  const floor: GuaranteePolicy = { period: 'week', guaranteedCents: 100_000, proration: 'none', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS };
  const hourly = { id: 'p', technicianId: 'h', branchId: null, payType: 'hourly' as const, hourlyRateCents: 2_000, salaryCentsPerPeriod: null, breaksPaid: false, overtimeWeeklyMinutes: 2400, effectiveStart: '2026-01-01', effectiveEnd: null, status: 'active' as const, note: null };
  const shift = { shifts: [{ startMs: Date.parse('2026-06-02T13:00:00Z'), endMs: Date.parse('2026-06-02T21:00:00Z') }], breaks: [], openShifts: 0 };
  const single: AutoBuildPorts = {
    technicianSums: async () => [{ technicianId: 'a', branchId: 'b1', sums: sums(50_000) }, { technicianId: 'h', branchId: 'b1', sums: sums(40_000) }],
    resolveGuarantee: async (_t, id) => (id === 'a' ? floor : null),
    netAdjustments: async () => 0,
    adjustmentBreakdown: async (_t, id) => (id === 'a' ? { bonusCents: 500, deductionCents: 200, otherCents: 100 } : { bonusCents: 0, deductionCents: 0, otherCents: 0 }),
    resolveTierPlan: async (_t, id) => (id === 'a' ? { mode: 'entire', bands: [{ uptoCents: null, ratePercent: 50 }] } : null),
    payPlan: async (_t, id) => (id === 'h' ? hourly : null),
    timeFacts: async () => shift,
    periodFacts: async () => ({ clockedIn: true, hoursWorked: 8 }),
  };
  const refuse = () => { throw new Error('per-technician port called although the batch port exists'); };
  const batch: AutoBuildPorts = {
    ...single,
    resolveGuarantee: refuse, adjustmentBreakdown: async () => refuse(), resolveTierPlan: refuse, payPlan: refuse, timeFacts: refuse, periodFacts: refuse,
    resolveGuarantees: async () => new Map([['a', floor], ['h', null]]),
    adjustmentBreakdowns: async () => new Map([['a', { bonusCents: 500, deductionCents: 200, otherCents: 100 }]]),   // h absent ⇒ zero ledger
    resolveTierPlans: async () => new Map([['a', { mode: 'entire' as const, bands: [{ uptoCents: null, ratePercent: 50 }] }]]),
    payPlans: async () => new Map([['h', hourly]]),
    timeFactsForTechnicians: async (_t, ids) => { expect(ids).toEqual(['h']); return new Map([['h', shift]]); },   // the clock only for hourly technicians
    periodFactsForTechnicians: async (_t, ids) => { expect(ids).toEqual(['a']); return new Map([['a', { clockedIn: true, hoursWorked: 8 }]]); },   // facts only where a guarantee applies
  };
  const args = { tenantId: 't1', fromIso: '2026-06-01T00:00:00Z', toIso: '2026-06-08T00:00:00Z', periodId: 'p1', periodStart: '2026-06-01', periodEnd: '2026-06-07' };

  it('uses the batch ports (never the per-technician ones) and builds exactly the per-technician lines', async () => {
    const one = await autoBuildPeriod(single, args);
    const many = await autoBuildPeriod(batch, args);
    expect(many).toEqual(one);
    expect(one.find((l) => l.technicianId === 'a')).toMatchObject({ serviceCommissionCents: 25_000, bonusCents: 500, deductionCents: 200, adjustmentCents: 100 });
    expect(one.find((l) => l.technicianId === 'h')).toMatchObject({ payType: 'hourly', hourlyPayCents: 16_000, serviceCommissionCents: 0 });
    expect(one.find((l) => l.technicianId === 'a')!.guaranteeTopUpCents).toBeGreaterThan(0);
  });

  it('a failing batch attendance read never fails the build (the engine fail-safe applies, as with the single port)', async () => {
    const lines = await autoBuildPeriod({ ...batch, periodFactsForTechnicians: async () => { throw new Error('facts down'); } }, args);
    const failSingle = await autoBuildPeriod({ ...single, periodFacts: async () => { throw new Error('facts down'); } }, args);
    expect(lines).toEqual(failSingle);
  });
});
