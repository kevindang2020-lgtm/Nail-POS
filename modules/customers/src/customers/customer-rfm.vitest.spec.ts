// customer-rfm.vitest.spec.ts — F1 §38: RFM uses Recency, Frequency AND Monetary; no visit history is its own segment.
import { describe, it, expect } from 'vitest';
import { buildCustomersAnalytics } from './customers.dto';

const seg = (rows: { totalSpendCents: number; visitCount: number; recencyDays: number }[]) =>
  Object.fromEntries(buildCustomersAnalytics(rows).rfm.map((x) => [x.segment, x.count]));

describe('RFM segments (F1 §38)', () => {
  it('a customer who never visited is "No Visits Yet", not Hibernating', () => {
    expect(seg([{ totalSpendCents: 0, visitCount: 0, recencyDays: Infinity }])).toEqual({ 'No Visits Yet': 1 });
  });
  it('Monetary counts: a top-spending 4-visit customer seen this month is a Champion; a low spender with the same R/F is Loyal', () => {
    const rows = [
      { totalSpendCents: 90000, visitCount: 4, recencyDays: 5 },   // top 20 %
      { totalSpendCents: 1000, visitCount: 4, recencyDays: 5 },
      ...Array.from({ length: 8 }, () => ({ totalSpendCents: 5000, visitCount: 2, recencyDays: 200 })),
    ];
    const s = seg(rows);
    expect(s.Champions).toBe(1);
    expect(s['Loyal Customers']).toBe(1);
  });
  it('a lapsed 3-visit top spender is "Cannot Lose Them"; a lapsed 3-visit low spender is Hibernating', () => {
    const rows = [
      { totalSpendCents: 120000, visitCount: 3, recencyDays: 150 },
      { totalSpendCents: 3000, visitCount: 3, recencyDays: 150 },
      ...Array.from({ length: 8 }, () => ({ totalSpendCents: 4000, visitCount: 1, recencyDays: 10 })),
    ];
    const s = seg(rows);
    expect(s['Cannot Lose Them']).toBe(1);
    expect(s.Hibernating).toBe(1);
  });
  it('8+ visits this month is a Champion whatever the spend (R/F rule unchanged)', () => {
    expect(seg([{ totalSpendCents: 100, visitCount: 9, recencyDays: 3 }])).toEqual({ Champions: 1 });
  });
});
