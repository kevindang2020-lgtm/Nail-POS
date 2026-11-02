import { describe, it, expect } from 'vitest';
import { buildDisputesOverview, normalizeReasonCategory, type DisputeRow } from './disputes-overview-core';

const now = new Date('2026-05-06T12:00:00Z').getTime();
const row = (o: Partial<DisputeRow>): DisputeRow => ({
  id: 'CHB-1', tenantId: 't1', tenantName: 'Pilot', branchName: 'Main', amountCents: 100000, status: 'open',
  evidenceStatus: 'not_requested', processorDecision: 'none', reasonCode: '10.4', reasonCategory: 'fraud_card_absent',
  fundsWithdrawnCents: 100000, fundsRecoveredCents: 0, riskLevel: 'high', openedAt: '2026-05-01T00:00:00Z',
  dueBy: '2026-05-08T00:00:00Z', decidedAt: null, ...o,
});

describe('buildDisputesOverview', () => {
  const input = {
    disputes: [
      row({ id: 'A', status: 'open', dueBy: '2026-05-08T00:00:00Z' }),
      row({ id: 'B', status: 'submitted', evidenceStatus: 'submitted', dueBy: '2026-05-10T00:00:00Z' }),
      row({ id: 'C', status: 'won', evidenceStatus: 'accepted', processorDecision: 'won', fundsWithdrawnCents: 50000, fundsRecoveredCents: 50000, dueBy: null }),
      row({ id: 'D', status: 'lost', evidenceStatus: 'accepted', processorDecision: 'lost', fundsWithdrawnCents: 60000, fundsRecoveredCents: 0, dueBy: null }),
      row({ id: 'E', status: 'open', reasonCode: '13.1', dueBy: '2026-06-30T00:00:00Z' }), // far out — not "this week"
    ],
    activity: [], risk: [], trend: [],
    wonCountPeriod: 346, lostCountPeriod: 40, underReviewCountPeriod: 62,
  };
  const o = buildDisputesOverview(input, now);

  it('counts open disputes and amount at risk', () => {
    expect(o.kpis.totalOpenDisputes).toBe(3); // A, B, E
    expect(o.kpis.amountAtRiskCents).toBe(300000);
  });
  it('counts deadlines this week (open, 0..7 days)', () => {
    expect(o.kpis.responseDeadlinesThisWeek).toBe(2); // A(2d), B(4d); E is far out
  });
  it('counts evidence submitted, won, lost', () => {
    expect(o.kpis.evidenceSubmitted).toBe(3); // B submitted, C+D accepted
    expect(o.kpis.wonDisputes).toBe(1);
    expect(o.kpis.lostDisputes).toBe(1);
  });
  it('computes funds summary with safe recovery rate', () => {
    expect(o.fundsSummary.fundsWithdrawnCents).toBe(100000 + 100000 + 50000 + 60000 + 100000);
    expect(o.fundsSummary.fundsRecoveredCents).toBe(50000);
    expect(o.fundsSummary.netLostCents).toBe(o.fundsSummary.fundsWithdrawnCents - 50000);
    expect(o.fundsSummary.recoveryRatePct).toBeCloseTo((50000 / o.fundsSummary.fundsWithdrawnCents) * 100, 1);
  });
  it('recovery rate is 0 when nothing withdrawn (no divide-by-zero)', () => {
    const z = buildDisputesOverview({ ...input, disputes: [row({ fundsWithdrawnCents: 0, fundsRecoveredCents: 0 })] }, now);
    expect(z.fundsSummary.recoveryRatePct).toBe(0);
  });
  it('reason distribution + processor breakdown reconcile', () => {
    expect(o.reasonDistribution.reduce((s, r) => s + r.count, 0)).toBe(5);
    expect(o.processorDecisionBreakdown.total).toBe(448);
  });
  it('approaching deadlines are open + within 7 days, sorted', () => {
    expect(o.approachingDeadlines.map((x) => x.disputeRef)).toEqual(['A', 'B']);
  });
});

describe('normalizeReasonCategory', () => {
  it('maps known codes and falls back to other', () => {
    expect(normalizeReasonCategory('10.4')).toBe('fraud_card_absent');
    expect(normalizeReasonCategory('13.1')).toBe('not_received');
    expect(normalizeReasonCategory('99.9')).toBe('other');
    expect(normalizeReasonCategory(null)).toBe('other');
  });
});
