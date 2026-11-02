import { describe, it, expect } from 'vitest';
import { buildPatterns, suggestRiskLevel, type PatternRow } from './patterns-core';

const row = (o: Partial<PatternRow>): PatternRow => ({
  tenantName: 'Pilot', branchName: 'Main', reasonCode: '10.4', reasonCategory: 'fraud_card_absent', processor: 'fiserv',
  status: 'open', processorDecision: 'none', amountCents: 100000, fundsWithdrawnCents: 100000, fundsRecoveredCents: 0, riskLevel: 'high', ...o,
});

describe('buildPatterns', () => {
  const rows = [
    row({ tenantName: 'Pilot', status: 'open', reasonCode: '10.4', reasonCategory: 'fraud_card_absent' }),
    row({ tenantName: 'Pilot', status: 'won', reasonCode: '13.1', reasonCategory: 'not_received', fundsWithdrawnCents: 80000, fundsRecoveredCents: 80000 }),
    row({ tenantName: 'Second', status: 'lost', reasonCode: '10.5', reasonCategory: 'fraud_card_present', fundsWithdrawnCents: 60000, fundsRecoveredCents: 0 }),
    row({ tenantName: 'Second', status: 'submitted', reasonCode: '10.4', reasonCategory: 'fraud_card_absent' }),
  ];
  const p = buildPatterns(rows);

  it('computes totals with safe rates', () => {
    expect(p.totals.count).toBe(4);
    expect(p.totals.decided).toBe(2); // 1 won + 1 lost
    expect(p.totals.winRatePct).toBe(50);
    expect(p.totals.lossRatePct).toBe(50);
    expect(p.totals.recoveryRatePct).toBeCloseTo((80000 / (100000 + 80000 + 60000 + 100000)) * 100, 1);
  });
  it('amount at risk counts only open statuses', () => {
    expect(p.totals.amountAtRiskCents).toBe(100000 + 100000); // two open/submitted rows
  });
  it('groups by reason, tenant, processor, and card presence', () => {
    expect(p.byReason.find((r) => r.code === '10.4')?.count).toBe(2);
    expect(p.byTenant.map((t) => t.tenant).sort()).toEqual(['Pilot', 'Second']);
    expect(p.byProcessor[0].processor).toBe('fiserv');
    expect(p.byCardPresence).toEqual({ cardPresent: 1, cardAbsent: 2, other: 1 });
  });
  it('handles zero denominators (no decided disputes)', () => {
    const z = buildPatterns([row({ status: 'open', fundsWithdrawnCents: 0, fundsRecoveredCents: 0 })]);
    expect(z.totals.winRatePct).toBe(0);
    expect(z.totals.recoveryRatePct).toBe(0);
  });
});

describe('suggestRiskLevel', () => {
  it('escalates with exposure and losses', () => {
    expect(suggestRiskLevel(0, 0, 400000)).toBe('critical');
    expect(suggestRiskLevel(0, 4, 0)).toBe('critical');
    expect(suggestRiskLevel(4, 0, 0)).toBe('high');
    expect(suggestRiskLevel(2, 0, 0)).toBe('medium');
    expect(suggestRiskLevel(0, 0, 0)).toBe('low');
  });
});
