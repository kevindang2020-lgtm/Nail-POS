// payroll-workflow.vitest.spec.ts — Payroll mandate wave 2 (Oct 12 2026): the PURE pieces of the review / approval /
// payout / export workflow, hourly / salary pay, overlap refusal, chargeback pro-rata. No database, no clock (fixed inputs).
import { describe, it, expect } from 'vitest';
import { canonicalLineHash, evaluateValidation, lineNetAndPayable, payoutHeadroom, PayrollError, type ValidationFacts } from './payroll-workflow';
import { buildPayrollExport, centsToDecimalString, exportGrid, toPayrollCsv } from './payroll-export';
import { dashboardStatusOf, PAYROLL_PERIOD, PAYROLL_PAYOUT } from './payroll.dto';
import { computeHourly, salaryForPeriod, componentsFor } from '../compensation/compensation-pay-plans';
import { findOverlappingRule } from '../compensation/compensation-rules.service';
import { buildRefundReversal } from '../compensation/compensation-adjustments';
import { COMPENSATION_ADJUSTMENT } from '../workforce-lifecycles';
import { NotConfiguredPayrollProvider } from './payroll-provider.port';

const L = (technicianId: string, payableCents: number, extra: Record<string, number> = {}) => ({ technicianId, servicesCount: 3, grossSalesCents: 10000, commissionCents: 6000, tipsCents: 1000, adjustmentCents: 0, payableCents, ...extra });
const NOFACTS: ValidationFacts = { lines: [{ technicianId: 'a', netCents: 7000, deductionCents: 0, nonTipCents: 6000 }], unassignedSnapshotRows: [], paidTicketsWithoutSnapshot: [], tipMismatches: [], duplicateSnapshotKeys: 0,
  pendingAdjustments: [], openTimeEntries: [], openExceptions: [], legacyRuleLines: 0, reconciliationDrift: [], deductionOverCap: [] };

describe('§119–§121 approval integrity hash', () => {
  it('is deterministic and order-independent; any changed cent changes it', () => {
    const h1 = canonicalLineHash('p1', [L('a', 7000), L('b', 5000)]);
    expect(canonicalLineHash('p1', [L('b', 5000), L('a', 7000)])).toBe(h1);
    expect(canonicalLineHash('p1', [L('a', 7001), L('b', 5000)])).not.toBe(h1);
    expect(canonicalLineHash('p2', [L('a', 7000), L('b', 5000)])).not.toBe(h1);                 // bound to the period
    expect(canonicalLineHash('p1', [L('a', 7000), L('b', 5000)], 'other-calc')).not.toBe(h1);   // and the calculation version
    expect(canonicalLineHash('p1', [L('a', 7000, { bonusCents: 0 }), L('b', 5000)])).toBe(h1);    // a missing component hashes as 0
  });
});

describe('§148/§150/§61 net and payable', () => {
  it('net = earnings + tips + bonus + adjustments − deductions; payable never negative; deductions never eat tips', () => {
    const ok = lineNetAndPayable({ serviceCommissionCents: 6000, retailCommissionCents: 200, guaranteeTopUpCents: 0, hourlyPayCents: 0, salaryPayCents: 0, tipsCents: 2101, bonusCents: 500, adjustmentCents: -300, deductionCents: 1200 });
    expect(ok).toEqual({ netCents: 6000 + 200 + 2101 + 500 - 300 - 1200, payableCents: 7301, reviewRequired: false, deductionExceedsNonTip: false });
    const neg = lineNetAndPayable({ serviceCommissionCents: 0, retailCommissionCents: 0, guaranteeTopUpCents: 0, hourlyPayCents: 0, salaryPayCents: 0, tipsCents: 0, bonusCents: 0, adjustmentCents: -4500, deductionCents: 0 });
    expect(neg.netCents).toBe(-4500); expect(neg.payableCents).toBe(0); expect(neg.reviewRequired).toBe(true);   // §150: never a negative payment
    const tipsOnly = lineNetAndPayable({ serviceCommissionCents: 1000, retailCommissionCents: 0, guaranteeTopUpCents: 0, hourlyPayCents: 0, salaryPayCents: 0, tipsCents: 5000, bonusCents: 0, adjustmentCents: 0, deductionCents: 1500 });
    expect(tipsOnly.deductionExceedsNonTip).toBe(true);   // 1500 > 1000 non-tip — the tips (5000) would have paid it: refused
  });
});

describe('§149 payout headroom', () => {
  it('failed / canceled payouts do not count; pending ones do (committed)', () => {
    expect(payoutHeadroom(10000, [{ amountCents: 4000, status: 'paid' }, { amountCents: 3000, status: 'pending' }, { amountCents: 9999, status: 'failed' }, { amountCents: 5, status: 'canceled' }]))
      .toEqual({ committedCents: 7000, paidCents: 4000, headroomCents: 3000 });
    expect(payoutHeadroom(100, [{ amountCents: 100, status: 'paid' }]).headroomCents).toBe(0);
  });
});

describe('§143–§145 pre-approval validation', () => {
  it('a clean period has no blocking issue', () => { const v = evaluateValidation(NOFACTS, '2026-06-30T00:00:00.000Z'); expect(v.ok).toBe(true); expect(v.blocking).toBe(0); expect(v.checkedAt).toBe('2026-06-30T00:00:00.000Z'); });
  it('each critical error blocks; warnings do not', () => {
    const v = evaluateValidation({ ...NOFACTS,
      lines: [{ technicianId: 'a', netCents: -100, deductionCents: 0, nonTipCents: 0 }, { technicianId: 'b', netCents: 100, deductionCents: 900, nonTipCents: 500 }],
      unassignedSnapshotRows: [{ ticketId: 't1' }, { ticketId: 't1' }], paidTicketsWithoutSnapshot: [{ ticketId: 't2' }], tipMismatches: [{ ticketId: 't3', tipCents: 2101, allocatedCents: 2100 }],
      duplicateSnapshotKeys: 1, openTimeEntries: [{ technicianId: 'h', hourly: true }, { technicianId: 'c', hourly: false }], openExceptions: [{ kind: 'missing_snapshot', severity: 'blocking' }, { kind: 'chargeback_review', severity: 'warning' }],
      pendingAdjustments: [{ technicianId: 'a', category: 'bonus', status: 'pending' }], legacyRuleLines: 4, reconciliationDrift: [{ technicianId: 'a', persistedPayableCents: 1, recomputedPayableCents: 2 }],
      deductionOverCap: [{ technicianId: 'b', type: 'supply', capCents: 500, totalCents: 900 }] }, 'x');
    const codes = (sev: string) => v.issues.filter((i) => i.severity === sev).map((i) => i.code).sort();
    expect(codes('blocking')).toEqual(['DEDUCTION_EXCEEDS_EARNINGS', 'DEDUCTION_OVER_CAP', 'DUPLICATE_COMMISSION', 'MISSING_COMPENSATION', 'MISSING_TECHNICIAN', 'NEGATIVE_NET_PAY', 'OPEN_FINANCIAL_EXCEPTIONS', 'OPEN_TIME_ENTRY', 'UNALLOCATED_TIP']);
    expect(codes('warning')).toEqual(['FINANCIAL_EXCEPTIONS_TO_REVIEW', 'LEGACY_RULE_PROVENANCE', 'OPEN_TIME_ENTRY_INFO', 'PAYROLL_CHANGED_SINCE_BUILD', 'PENDING_ADJUSTMENTS']);
    expect(v.issues.find((i) => i.code === 'MISSING_TECHNICIAN')!.ticketIds).toEqual(['t1']);   // de-duplicated
    expect(v.ok).toBe(false);
  });
});

describe('§66 / §151 states', () => {
  it('the period machine: draft → review → finalized → paid; send back; reopen only from finalized; paid terminal', () => {
    expect(PAYROLL_PERIOD.can('draft', 'review')).toBe(true); expect(PAYROLL_PERIOD.can('review', 'finalized')).toBe(true);
    expect(PAYROLL_PERIOD.can('review', 'draft')).toBe(true); expect(PAYROLL_PERIOD.can('finalized', 'draft')).toBe(true);
    expect(PAYROLL_PERIOD.can('paid', 'draft')).toBe(false); expect(PAYROLL_PERIOD.can('review', 'paid')).toBe(false); expect(PAYROLL_PERIOD.can('draft', 'paid')).toBe(false);
  });
  it('payout + adjustment machines refuse re-deciding', () => {
    // Weekly Paycheck (Oct 21 2026): the ONE re-decision a paid payout allows is a delivered paycheck CHECK voided / returned
    // by the bank (paid → canceled, through voidCheck only — setPayoutStatus refuses any paid payout, see the pgtest)
    expect(PAYROLL_PAYOUT.can('paid', 'canceled')).toBe(true); expect(PAYROLL_PAYOUT.can('paid', 'failed')).toBe(false); expect(PAYROLL_PAYOUT.can('paid', 'pending')).toBe(false);
    expect(PAYROLL_PAYOUT.can('pending', 'paid')).toBe(true); expect(PAYROLL_PAYOUT.can('failed', 'paid')).toBe(false);
    expect(COMPENSATION_ADJUSTMENT.can('pending', 'approved')).toBe(true); expect(COMPENSATION_ADJUSTMENT.can('approved', 'rejected')).toBe(false); expect(COMPENSATION_ADJUSTMENT.can('posted', 'rejected')).toBe(false);
  });
  it('dashboard status', () => {
    expect(dashboardStatusOf({ status: 'draft' })).toBe('OPEN'); expect(dashboardStatusOf({ status: 'draft', warningCount: 2 })).toBe('NEEDS_REVIEW');
    expect(dashboardStatusOf({ status: 'review' })).toBe('READY_TO_APPROVE'); expect(dashboardStatusOf({ status: 'review', blockingCount: 1 })).toBe('HAS_EXCEPTIONS');
    expect(dashboardStatusOf({ status: 'finalized', blockingCount: 3 })).toBe('LOCKED'); expect(dashboardStatusOf({ status: 'paid' })).toBe('PAID');
  });
});

describe('§82–§84 / §156 export precision', () => {
  const period = { id: 'p1', label: 'Jun', periodStart: '2026-06-01', periodEnd: '2026-06-15', status: 'finalized', version: 4, approvalHash: 'abc' };
  const line = { technicianId: 't1', technicianName: '=HYPERLINK("x")', servicesCount: 2, grossSalesCents: 2101, commissionCents: 1, retailCommissionCents: 0, cardTipCents: 1051, cashTipCents: 1050, tipsCents: 2101,
    guaranteeTopUpCents: 0, hourlyPayCents: 0, workedMinutes: 0, potentialOvertimeMinutes: 0, salaryPayCents: 0, bonusCents: 0, deductionCents: 0, adjustmentCents: -7, netCents: 2095, payableCents: 2095, paidCents: 0 };
  it('cents → dollars by integer arithmetic only', () => {
    expect(centsToDecimalString(1)).toBe('0.01'); expect(centsToDecimalString(2)).toBe('0.02'); expect(centsToDecimalString(-7)).toBe('-0.07');
    expect(centsToDecimalString(123456789012)).toBe('1234567890.12'); expect(centsToDecimalString(0)).toBe('0.00');
  });
  it('CSV keeps exact cents, guards formula injection, and is stable', () => {
    const csv = toPayrollCsv(period, [line]).toString('utf8');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);   // neutralised
    expect(csv).toContain(',2101,21.01,'); expect(csv).toContain(',-7,-0.07,');
    expect(exportGrid(period, [line]).headers).toContain('payable_usd');
    const a = buildPayrollExport('csv', period, [line]); const b = buildPayrollExport('csv', period, [line]);
    expect(a.sha256).toBe(b.sha256); expect(a.filename).toBe('payroll-2026-06-01-to-2026-06-15-v4.csv');
  });
  it('XLSX is a real OOXML zip with integer cents cells', () => {
    const x = buildPayrollExport('xlsx', period, [line]);
    expect(x.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(x.bytes.toString('latin1')).toContain('<v>2101</v>');
    expect(x.mimeType).toMatch(/spreadsheetml/);
  });
});

describe('§38–§44 hourly / salary', () => {
  const H = (s: string, e: string) => ({ startMs: Date.parse(s), endMs: Date.parse(e) });
  it('worked minutes from server instants, unpaid breaks subtracted, potential overtime per tenant week, exact cents', () => {
    // Mon–Fri 9h shifts (45h) with a 30-min unpaid lunch each day → 42.5h paid; threshold 40h → 150 potential OT minutes
    const shifts = [8, 9, 10, 11, 12].map((d) => H(`2026-06-${String(d).padStart(2, '0')}T13:00:00Z`, `2026-06-${String(d).padStart(2, '0')}T22:00:00Z`));
    const breaks = [8, 9, 10, 11, 12].map((d) => H(`2026-06-${String(d).padStart(2, '0')}T17:00:00Z`, `2026-06-${String(d).padStart(2, '0')}T17:30:00Z`));
    const r = computeHourly(shifts, breaks, { hourlyRateCents: 1525, breaksPaid: false, overtimeWeeklyMinutes: 2400 }, 'America/New_York');
    expect(r.workedMinutes).toBe(2700); expect(r.breakMinutes).toBe(150); expect(r.paidMinutes).toBe(2550); expect(r.potentialOvertimeMinutes).toBe(150);
    expect(r.hourlyPayCents).toBe(Math.round(2550 * 1525 / 60));   // 64812.5 → 64813 (exact half-up on an integer product)
    expect(computeHourly(shifts, breaks, { hourlyRateCents: 1525, breaksPaid: true, overtimeWeeklyMinutes: 2400 }, 'America/New_York').paidMinutes).toBe(2700);   // §41 paid breaks
  });
  it('§127 a DST night is measured in real elapsed time', () => {
    // US fall-back Nov 1 2026: 22:00 EDT (02:00Z) → 06:00 EST (11:00Z) is 9 real hours, not 8
    const r = computeHourly([H('2026-11-01T02:00:00Z', '2026-11-01T11:00:00Z')], [], { hourlyRateCents: 2000, breaksPaid: false, overtimeWeeklyMinutes: 2400 }, 'America/New_York');
    expect(r.workedMinutes).toBe(540); expect(r.hourlyPayCents).toBe(18000);
  });
  it('salary prorates by covered civil days; components by pay type', () => {
    expect(salaryForPeriod(150000, { start: '2026-06-01', end: '2026-06-14' }, { effectiveStart: '2026-01-01', effectiveEnd: null })).toBe(150000);
    expect(salaryForPeriod(140000, { start: '2026-06-01', end: '2026-06-14' }, { effectiveStart: '2026-06-08', effectiveEnd: null })).toBe(70000);   // 7 of 14 days
    expect(componentsFor(null)).toEqual({ commission: true, hourly: false, salary: false });
    expect(componentsFor({ payType: 'hourly', hourlyRateCents: 1500, salaryCentsPerPeriod: null })).toEqual({ commission: false, hourly: true, salary: false });
    expect(componentsFor({ payType: 'hybrid', hourlyRateCents: 1500, salaryCentsPerPeriod: null })).toEqual({ commission: true, hourly: true, salary: false });
  });
});

describe('§142 overlapping rules', () => {
  const v = (id: string, status: string, s: string, e: string | null) => ({ id, version: 1, commissionType: 'percent', commissionValue: 60, supplyMethod: 'none', supplyValue: 0, discountFunding: 'proportional', effectiveStart: s, effectiveEnd: e, status, approved: true, createdAt: s });
  const P = (id: string, scope: any, versions: any[]) => ({ id, scope, label: null, createdAt: '2026-01-01', versions });
  it('refuses the same exact scope with overlapping windows; allows a different scope or a non-overlapping window', () => {
    const policies = [P('A', { technicianId: 't1', serviceId: 's1' }, [v('a1', 'active', '2026-01-01T00:00:00Z', null)]), P('B', { technicianId: 't1', serviceId: 's1' }, [v('b1', 'draft', '2026-06-01T00:00:00Z', null)]),
      P('C', { technicianId: 't1', serviceId: 's2' }, [v('c1', 'draft', '2026-06-01T00:00:00Z', null)]), P('D', { technicianId: 't2' }, [v('d1', 'active', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z')]),
      P('E', { technicianId: 't2' }, [v('e1', 'draft', '2026-03-01T00:00:00Z', null)])];
    expect(findOverlappingRule(policies as any, 'B', { effectiveStart: '2026-06-01T00:00:00Z', effectiveEnd: null })).toEqual({ policyId: 'A', versionId: 'a1' });
    expect(findOverlappingRule(policies as any, 'C', { effectiveStart: '2026-06-01T00:00:00Z', effectiveEnd: null })).toBeNull();
    expect(findOverlappingRule(policies as any, 'E', { effectiveStart: '2026-03-01T00:00:00Z', effectiveEnd: null })).toBeNull();   // half-open: D ends when E starts
  });
});

describe('§55 chargebacks / §33 retail reversal', () => {
  const rows = [{ service_line_id: 'L1', technician_id: 'a', tech_service_earnings_cents: 6000, salon_service_share_cents: 4000, supply_cents: 0, card_tip_cents: 1000, cash_tip_cents: 0, retail_commission_cents: 200 }];
  it('a partial chargeback reverses pro-rata, waits for review, keeps the retail part separate, never the tip by default', () => {
    const e = buildRefundReversal('tk', rows, { type: 'chargeback', refundedCents: 2500, capturedCents: 10000 }, { reason: 'cb', requestedBy: null, chargebackId: 'cb1' });
    expect(e.find((x) => x.category === 'chargeback_reversal')!.amountCents).toBe(-1500);
    expect(e.find((x) => x.category === 'retail_reversal')!.amountCents).toBe(-50);
    expect(e.some((x) => x.category === 'tip_correction')).toBe(false);
    expect(e.every((x) => x.status === 'pending_review' && x.chargebackId === 'cb1')).toBe(true);
  });
  it('a full refund reverses the retail commission on the SAME line under its own category (the 588 index no longer drops it)', () => {
    const e = buildRefundReversal('tk', rows, { type: 'full' }, { reason: 'r', requestedBy: null });
    const keys = e.map((x) => `${x.serviceLineId}|${x.technicianId}|${x.category}`);
    expect(new Set(keys).size).toBe(keys.length);   // unique per (line, tech, category) — the idempotency key
    expect(e.find((x) => x.category === 'retail_reversal')!.amountCents).toBe(-200);
  });
});

describe('§137 external provider', () => {
  it('is honestly not configured', async () => {
    const p = new NotConfiguredPayrollProvider();
    expect((await p.status()).configured).toBe(false);
    await expect(p.submitPeriod()).rejects.toMatchObject({ code: 'PAYROLL_PROVIDER_NOT_CONFIGURED' });
    expect(new PayrollError('PAYROLL_VERSION_CONFLICT', 'x').status).toBe(409);
  });
});
