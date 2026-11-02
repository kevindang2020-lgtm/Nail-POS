// dashboard-metrics.vitest.spec.ts — assertions for the §20 derived-metric helpers.
//
// Oct 26 2026 (dead-code pass): this was dashboard-metrics.spec.ts, an esbuild ok()-style harness whose name matched
// no runner (not *-core.spec.ts, not *.vitest.spec.ts), so it never ran in CI. It passed 12/12 when run by hand; ported
// to vitest unchanged so it now runs with the module suite.
import { describe, it, expect } from 'vitest';
import { averageTicketCents, rebookRatePercent, utilizationPercent, onDutyPercent, trendPercent } from './dashboard.dto';

describe('dashboard derived metrics', () => {
  it('average ticket = revenue / count, zero-count safe, rounded', () => {
    expect(averageTicketCents(78500, 10)).toBe(7850);
    expect(averageTicketCents(5000, 0)).toBe(0);
    expect(averageTicketCents(10000, 3)).toBe(3333);
  });

  it('rebook rate %, zero-eligible safe', () => {
    expect(rebookRatePercent(34, 50)).toBe(68);
    expect(rebookRatePercent(5, 0)).toBe(0);
  });

  it('utilization %, capped at 100, zero-available safe', () => {
    expect(utilizationPercent(330, 400)).toBe(83);
    expect(utilizationPercent(500, 400)).toBe(100);
    expect(utilizationPercent(100, 0)).toBe(0);
  });

  it('on-duty %, zero-scheduled safe', () => {
    expect(onDutyPercent(8, 12)).toBe(67);
    expect(onDutyPercent(5, 0)).toBe(0);
  });

  it('trend % never divides by zero (defined new-growth state)', () => {
    expect(trendPercent(118, 100)).toBe(18);
    expect(Number.isFinite(trendPercent(50, 0))).toBe(true);
  });
});
