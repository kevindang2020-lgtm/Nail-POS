import { describe, it, expect } from 'vitest';
import { buildCommissionReport, presetRange, type CommissionLine } from './commission-report.dto';
import { InMemoryCommissionReportRepository } from './commission-report.repository';
import { CommissionReportService, CommissionReportForbiddenError } from './commission-report.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.reports.view'] };

describe('commission-report — pure builder', () => {
  it('rolls up snapshot commission + tips per technician, sorted by commission', () => {
    const lines: CommissionLine[] = [
      { technicianId: 'A', lineTotalCents: 10000, commissionType: 'percent', commissionValue: 40, commissionCents: 4000 },
      { technicianId: 'A', lineTotalCents: 5000, commissionType: 'percent', commissionValue: 40, commissionCents: 2000 },
      { technicianId: 'B', lineTotalCents: 8000, commissionType: 'flat', commissionValue: 1500, commissionCents: 1500 },
    ];
    const { kpis, rows } = buildCommissionReport(lines, { A: 1200, B: 800 }, { A: 'Ana', B: 'Ben' });
    expect(rows[0].technicianId).toBe('A');
    expect(rows[0].commissionCents).toBe(6000);
    expect(rows[0].serviceRevenueCents).toBe(15000);
    expect(rows[0].tipsCents).toBe(1200);
    expect(rows[0].payoutCents).toBe(7200);
    expect(rows[0].effectiveRatePercent).toBe(40);
    expect(rows[1].technicianId).toBe('B');
    expect(rows[1].commissionCents).toBe(1500);
    expect(kpis.technicianCount).toBe(2);
    expect(kpis.totalCommissionCents).toBe(7500);
    expect(kpis.totalTipsCents).toBe(2000);
    expect(kpis.totalPayoutCents).toBe(9500);
  });
  it('includes tip-only technicians and skips null-tech lines', () => {
    const { rows } = buildCommissionReport([{ technicianId: null, lineTotalCents: 9999, commissionCents: 5000 }], { C: 500 }, { C: 'Cara' });
    expect(rows).toHaveLength(1);
    expect(rows[0].technicianId).toBe('C'); expect(rows[0].commissionCents).toBe(0); expect(rows[0].tipsCents).toBe(500);
  });
  it('handles empty input', () => {
    const { kpis, rows } = buildCommissionReport([], {}, {});
    expect(rows).toHaveLength(0); expect(kpis.averageRatePercent).toBe(0); expect(kpis.totalPayoutCents).toBe(0);
  });
});

describe('commission-report — presetRange', () => {
  it('year preset starts Jan 1', () => { expect(presetRange('year', '2026-07-07T10:00:00Z').from).toBe('2026-01-01'); });
  it('month preset starts on the 1st', () => { expect(presetRange('month', '2026-07-07T10:00:00Z').from).toBe('2026-07-01'); });
  it('today preset from == today', () => { expect(presetRange('today', '2026-07-07T10:00:00Z').from).toBe('2026-07-07'); });
});

describe('commission-report — service', () => {
  it('defaults to month and returns kpis + rows', async () => {
    const svc = new CommissionReportService(new InMemoryCommissionReportRepository({ lines: [{ technicianId: 'A', lineTotalCents: 10000, commissionType: 'percent', commissionValue: 30, commissionCents: 3000 }], tipsByTech: { A: 500 }, techNames: { A: 'Ana' } }));
    const st = await svc.getState(ctx as any, 'bogus');
    expect(st.preset).toBe('month');
    expect(st.rows[0].commissionCents).toBe(3000);
    expect(st.kpis.totalPayoutCents).toBe(3500);
  });
  it('rejects unauthenticated', async () => {
    const svc = new CommissionReportService(new InMemoryCommissionReportRepository());
    await expect(svc.getState({ tenantId: '', userId: '' } as any)).rejects.toBeInstanceOf(CommissionReportForbiddenError);
  });
});

// Oct 13 2026 (FLOW duplicate D8): the report is the same money as payroll and the Tech App — posted ledger adjustments
// (a refund reversal, a correction) are part of a technician's commission, and tip corrections part of her tips.
describe('commission-report — posted adjustments are part of the period\'s money (D8)', () => {
  it('a refund reversal lowers the technician\'s commission and payout; a tip correction moves her tips; a tech with only an adjustment still appears', () => {
    const lines: CommissionLine[] = [{ technicianId: 'A', lineTotalCents: 10000, commissionType: 'percent', commissionValue: 60, commissionCents: 6000 }];
    const { rows, kpis } = buildCommissionReport(lines, { A: 1000 }, { A: 'Ana', Z: 'Zoe' }, { commission: { A: -2700, Z: -500 }, tips: { A: -200 } });
    const a = rows.find((r) => r.technicianId === 'A')!; const z = rows.find((r) => r.technicianId === 'Z')!;
    expect(a.commissionCents).toBe(3300); expect(a.tipsCents).toBe(800); expect(a.payoutCents).toBe(4100);
    expect(z.commissionCents).toBe(-500); expect(z.payoutCents).toBe(-500);
    expect(kpis.totalCommissionCents).toBe(2800); expect(kpis.totalTipsCents).toBe(800); expect(kpis.totalPayoutCents).toBe(3600);
  });
  it('the service passes the source\'s adjustments through', async () => {
    const svc = new CommissionReportService(new InMemoryCommissionReportRepository({ lines: [{ technicianId: 'A', lineTotalCents: 10000, commissionType: 'percent', commissionValue: 30, commissionCents: 3000 }], tipsByTech: { A: 500 }, techNames: { A: 'Ana' }, adjustments: { commission: { A: -3000 }, tips: {} } }));
    const st = await svc.getState(ctx as any, 'month');
    expect(st.rows[0].commissionCents).toBe(0);
  });
});

// ONE-PAY F4 (Oct 13 2026): the report never prices a line itself — the commission is the snapshot's figure or nothing.
describe('commission-report — no second formula (ONE-PAY F4)', () => {
  it('a rate-only line (no authority figure) adds revenue but NO recomputed commission', () => {
    const { rows } = buildCommissionReport([{ technicianId: 'A', lineTotalCents: 10000, commissionType: 'percent', commissionValue: 40 } as any], {}, { A: 'Ana' });
    expect(rows[0].serviceRevenueCents).toBe(10000);
    expect(rows[0].commissionCents).toBe(0);
  });
});
