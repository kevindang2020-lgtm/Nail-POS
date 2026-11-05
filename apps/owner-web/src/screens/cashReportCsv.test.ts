import { describe, it, expect } from 'vitest';
import { buildCashReportCsv } from './cashReportCsv';

const summary = {
  businessDate: '2026-06-16',
  register: { expectedCents: 24650, countedCents: 24650, varianceCents: 0, unitCount: 1, reconciledCount: 1, discrepancyCount: 0, awaitingCount: 0 },
  techCash: { expectedCents: 13300, countedCents: 13000, varianceCents: -300, unitCount: 1, reconciledCount: 0, discrepancyCount: 1, awaitingCount: 0 },
  total: { expectedCents: 37950, countedCents: 37650, varianceCents: -300 },
};

describe('buildCashReportCsv', () => {
  it('renders totals + per-branch + per-tech lines in dollars', () => {
    const branches = [{ branchName: 'Main', openingFloatCents: 10000, expectedSalesCents: 14150, refundsCents: 1000, paidInCents: 2000, paidOutCents: 500, expectedCashCents: 24650, countedCents: 24650, varianceCents: 0, status: 'reconciled' }];
    const techs = [{ technicianName: 'Ava Nguyen', expectedCents: 13300, countedCents: 13000, varianceCents: -300, status: 'discrepancy' }];
    const csv = buildCashReportCsv(summary as any, branches as any, techs as any);
    expect(csv).toContain('Date,2026-06-16');
    expect(csv).toContain('Total,379.50,376.50,-3.00');
    expect(csv).toContain('Main,100.00,141.50,10.00,20.00,5.00,246.50,246.50,0.00,reconciled');
    expect(csv).toContain('Ava Nguyen,133.00,130.00,-3.00,discrepancy');
  });
  it('escapes names with commas and blanks uncounted values', () => {
    const branches = [{ branchName: 'Main, West', openingFloatCents: 0, expectedSalesCents: 0, refundsCents: 0, paidInCents: 0, paidOutCents: 0, expectedCashCents: 0, countedCents: null, varianceCents: null, status: 'open' }];
    const csv = buildCashReportCsv(summary as any, branches as any, []);
    expect(csv).toContain('"Main, West"');
    expect(csv).toContain('"Main, West",0.00,0.00,0.00,0.00,0.00,0.00,,,open');
  });
});
