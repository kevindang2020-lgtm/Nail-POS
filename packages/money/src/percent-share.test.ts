// ONE-PAY F3 (Oct 13 2026): the ONE percent arithmetic every commission / revenue-share figure uses.
import { describe, it, expect } from 'vitest';
import { percentOfCents, splitByPercent } from './index';

describe('percentOfCents — round(base × pct / 100), integer cents', () => {
  it.each([[4500, 60, 2700], [1, 50, 1], [2, 33, 1], [9000, 0, 0], [100_000_000_00, 60, 6_000_000_000], [333, 33.3, 111]])('%s × %s%% → %s', (b, p, v) => expect(percentOfCents(b, p)).toBe(v));
});
describe('splitByPercent — share + remainder == base, share clamped to [0, base]', () => {
  it('60/40 of $45.00', () => expect(splitByPercent(4500, 60)).toEqual({ shareCents: 2700, remainderCents: 1800 }));
  it('odd cents reconcile exactly', () => { const s = splitByPercent(999, 33); expect(s.shareCents + s.remainderCents).toBe(999); expect(s.shareCents).toBe(330); });
  it('never above the base, never negative', () => { expect(splitByPercent(1000, 150)).toEqual({ shareCents: 1000, remainderCents: 0 }); expect(splitByPercent(1000, -5)).toEqual({ shareCents: 0, remainderCents: 1000 }); });
  it('negative / fractional base is rounded and floored at 0', () => { expect(splitByPercent(-10, 50)).toEqual({ shareCents: 0, remainderCents: 0 }); expect(splitByPercent(100.4, 50)).toEqual({ shareCents: 50, remainderCents: 50 }); });
});
