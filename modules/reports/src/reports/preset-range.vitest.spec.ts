// A4 (Nov 5 2026): last 7 / last 30 days and last month, salon-local; the previous period of each.
import { describe, it, expect } from 'vitest';
import { presetRange, previousPeriodRange } from './reports.kysely.repository';

const NOW = new Date('2026-03-15T15:00:00Z');   // Mar 15 in New York
describe('extra report ranges', () => {
  it('last 7 / last 30 days end today (inclusive); last month is the whole previous month', () => {
    expect(presetRange('last7', NOW, 'America/New_York')).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(presetRange('last30', NOW, 'America/New_York')).toEqual({ from: '2026-02-14', to: '2026-03-15' });
    expect(presetRange('last_month', NOW, 'America/New_York')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('last_month', new Date('2026-01-10T15:00:00Z'), 'America/New_York')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('the previous period: the same length before; the month before last month', () => {
    expect(previousPeriodRange('last7', NOW, 'America/New_York')).toEqual({ from: '2026-03-02', to: '2026-03-08' });
    expect(previousPeriodRange('last_month', NOW, 'America/New_York')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
});
