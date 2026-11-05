import { describe, it, expect } from 'vitest';
import { combineCashSummary } from './cash-summary';

describe('combineCashSummary', () => {
  it('aggregates register + tech pools into a total cash position', () => {
    const drawer = { branches: [
      { expectedCashCents: 20000, countedCents: 20000, varianceCents: 0, status: 'reconciled' },
      { expectedCashCents: 5000, countedCents: null, varianceCents: null, status: 'open' },
    ] };
    const tech = { totalExpectedCents: 13300, totalCountedCents: 13000, technicians: [{ varianceCents: -300, status: 'discrepancy' }] };
    const s = combineCashSummary('2026-06-16', drawer, tech);
    expect(s.register.expectedCents).toBe(25000);
    expect(s.register.reconciledCount).toBe(1);
    expect(s.register.awaitingCount).toBe(1);
    expect(s.techCash.varianceCents).toBe(-300);
    expect(s.techCash.discrepancyCount).toBe(1);
    expect(s.total.expectedCents).toBe(25000 + 13300);
    expect(s.total.countedCents).toBe(20000 + 13000);
    expect(s.total.varianceCents).toBe(-300);
  });
  it('handles empty pools safely', () => {
    const s = combineCashSummary('2026-06-16', { branches: [] }, { totalExpectedCents: 0, totalCountedCents: 0, technicians: [] });
    expect(s.total.expectedCents).toBe(0);
    expect(s.register.unitCount).toBe(0);
    expect(s.techCash.unitCount).toBe(0);
  });
});
