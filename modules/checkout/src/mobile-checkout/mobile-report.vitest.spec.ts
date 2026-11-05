import { describe, it, expect } from 'vitest';
import { computeReport, type AttemptReportInput } from './mobile-report';

const NOW = new Date('2026-06-28T18:00:00Z');
const at = (daysAgo: number, hour = 12) => new Date(NOW.getTime() - daysAgo * 86400000).toISOString().slice(0, 11) + String(hour).padStart(2, '0') + ':00:00Z';

const rows: AttemptReportInput[] = [
  { status: 'failed', amountCents: 3000, createdAt: at(0) },
  { status: 'created', amountCents: 2000, createdAt: at(0) },
  { status: 'canceled', amountCents: 1000, createdAt: at(2) },
  { status: 'failed', amountCents: 4000, createdAt: at(10) }, // outside 7d
];

describe('computeReport', () => {
  it('aggregates counts, attempted total, and daily buckets within the 7d window', () => {
    const r = computeReport(rows, '7d', NOW);
    expect(r.totalAttempts).toBe(3); // the 10-day-old one is excluded
    expect(r.byStatus).toEqual({ failed: 1, created: 1, canceled: 1 });
    expect(r.attemptedTotalCents).toBe(6000);
    expect(r.daily.length).toBe(2); // today + 2-days-ago
    expect(r.daily[0].date < r.daily[1].date).toBe(true); // ascending
  });

  it('reports settled as 0 until an attempt is confirmed (no inflation)', () => {
    expect(computeReport(rows, '30d', NOW).settledTotalCents).toBe(0);
    const withConfirmed = computeReport([...rows, { status: 'confirmed', amountCents: 5000, createdAt: at(1) }], '30d', NOW);
    expect(withConfirmed.settledTotalCents).toBe(5000); // only a real confirmed attempt counts as settled
  });

  it('today window excludes earlier days', () => {
    const r = computeReport(rows, 'today', NOW);
    expect(r.totalAttempts).toBe(2); // only today's two
  });
});

describe('computeReport — the branch\'s day (Oct 6 2026)', () => {
  // 9:30 pm Monday Oct 5 in New York = 01:30 UTC Tuesday
  const at = new Date('2026-10-06T01:30:00Z');
  const attempts: AttemptReportInput[] = [
    { status: 'confirmed', amountCents: 1000, createdAt: '2026-10-05T14:00:00Z' },   // 10 am today
    { status: 'confirmed', amountCents: 2000, createdAt: '2026-10-06T01:00:00Z' },   // 9 pm tonight (Tuesday in UTC)
    { status: 'declined', amountCents: 500, createdAt: '2026-10-05T03:00:00Z' },     // 11 pm last night (Monday in UTC)
  ];
  it('"today" is since New York\'s midnight: 10 am and 9 pm, not last night', () => {
    const r = computeReport(attempts, 'today', at, 'America/New_York');
    expect(r.totalAttempts).toBe(2);
    expect(r.settledTotalCents).toBe(3000);
  });
  it('the daily buckets are New York dates: tonight is Oct 5, last night Oct 4', () => {
    const r = computeReport(attempts, '7d', at, 'America/New_York');
    expect(r.daily).toEqual([{ date: '2026-10-04', count: 1, attemptedCents: 500 }, { date: '2026-10-05', count: 2, attemptedCents: 3000 }]);
  });
  it('the old UTC reading would have been wrong on both (so this test can tell)', () => {
    expect(computeReport(attempts, 'today', at, 'UTC').totalAttempts).toBe(1);
  });
});
