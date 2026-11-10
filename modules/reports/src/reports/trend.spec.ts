// trend.spec — batch 9 guide 3 (Nov 10 2026): every bucket present, chronological, sensible groupings, honest compare
import { describe, it, expect } from 'vitest';
import { buildTrend, emptyBuckets, groupByOptions, previousRange, change } from './trend';

const row = (id: string, at: string, occurredAt: string, sales: number, ticketId = id, status: 'completed' | 'refunded' = 'completed') =>
  ({ id, ticketId, at, occurredAt, salesCents: sales, grossCents: sales + 999, status } as any);

describe('Revenue & Appointments Trend buckets', () => {
  it('fills every day of the period (a quiet day is a real 0) and stays oldest → newest', () => {
    const t = buildTrend([row('a', '2026-11-05', '2026-11-05T15:00:00Z', 9600)], '2026-11-03', '2026-11-09', 'America/New_York');
    expect(t.groupBy).toBe('day');
    expect(t.buckets.map((b) => b.key)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    expect(t.buckets[2]).toMatchObject({ revenueCents: 9600, tickets: 1 });
  });
  it('uses the SALES basis, counts a split ticket once, ignores refunds', () => {
    const t = buildTrend([row('p1', '2026-11-05', '2026-11-05T15:00:00Z', 9600, 'T1'), row('p2', '2026-11-05', '2026-11-05T15:01:00Z', 0, 'T1'), row('r', '2026-11-05', '2026-11-05T16:00:00Z', 500, 'T1', 'refunded')], '2026-11-05', '2026-11-05', 'UTC', 'day');
    expect(t.totalRevenueCents).toBe(9600); expect(t.totalTickets).toBe(1);
  });
  it('a single day groups by the SALON hour, across a DST change', () => {
    // Nov 1 2026: US clocks fall back at 2 AM; 13:30Z is 8:30 AM EST, 05:30Z is 1:30 AM EDT
    const t = buildTrend([row('a', '2026-11-01', '2026-11-01T13:30:00Z', 100), row('b', '2026-11-01', '2026-11-01T05:30:00Z', 200)], '2026-11-01', '2026-11-01', 'America/New_York');
    expect(t.groupBy).toBe('hour'); expect(t.buckets).toHaveLength(24);
    expect(t.buckets[8].revenueCents).toBe(100); expect(t.buckets[1].revenueCents).toBe(200);
  });
  it('offers sensible groupings and clamps a nonsense request', () => {
    expect(groupByOptions('2026-01-01', '2026-12-31')).toEqual(['week', 'month']);
    expect(buildTrend([], '2026-01-01', '2026-12-31', 'UTC', 'hour').groupBy).toBe('week');
    const m = emptyBuckets('2026-01-15', '2026-03-10', 'month');
    expect(m.map((b) => [b.from, b.to])).toEqual([['2026-01-15', '2026-01-31'], ['2026-02-01', '2026-02-28'], ['2026-03-01', '2026-03-10']]);
    const w = emptyBuckets('2026-11-04', '2026-11-12', 'week');   // Wed → Thu: partial weeks keep their real days
    expect(w.map((b) => [b.from, b.to])).toEqual([['2026-11-04', '2026-11-08'], ['2026-11-09', '2026-11-12']]);
    expect(emptyBuckets('2028-02-01', '2028-02-29', 'day')).toHaveLength(29);   // leap year
  });
  it('compare: the previous period of the same length; a 0 baseline is insufficient data, not 0% or ∞', () => {
    expect(previousRange('2026-11-03', '2026-11-09')).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(change(150, 100)).toBe(50); expect(change(100, 0)).toBeNull();
  });
});
