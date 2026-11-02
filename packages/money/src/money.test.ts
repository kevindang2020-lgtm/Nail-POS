import { describe, it, expect } from 'vitest';
import { centsToUsd, centsToUsdCompact, formatCentsOrDash, formatCentsPlain, parseDollarsToCents, allocateByLargestRemainder, taxCents } from './index';
describe('formatters are distinct rules', () => {
  it('centsToUsd always two decimals with grouping', () => { expect(centsToUsd(123456)).toBe('$1,234.56'); expect(centsToUsd(1200)).toBe('$12.00'); expect(centsToUsd(-250)).toBe('−$2.50'); expect(centsToUsd(-123456)).toBe('−$1,234.56'); expect(centsToUsd(-0)).toBe('$0.00'); });
  it('compact drops decimals on whole dollars, rounds first', () => { expect(centsToUsdCompact(1200)).toBe('$12'); expect(centsToUsdCompact(1250)).toBe('$12.50'); expect(centsToUsdCompact(1249.6)).toBe('$12.50'); });
  it('or-dash', () => { expect(formatCentsOrDash(null)).toBe('—'); expect(formatCentsOrDash(5)).toBe('$0.05'); });
  it('plain: no grouping, clamps negatives to zero', () => { expect(formatCentsPlain(123456)).toBe('$1234.56'); expect(formatCentsPlain(-5)).toBe('$0.00'); });
});
describe('parseDollarsToCents is digit-exact', () => {
  it.each([['12.3', 1230], ['$0.5', 50], ['0.10', 10], [' 7 ', 700], ['', null], ['.', null], ['1.234', null], ['abc', null], ['1e3', null]])('%s → %s', (s, v) => expect(parseDollarsToCents(s)).toBe(v));
  it('no float ever: 0.1 + 0.2 style inputs cannot produce 30.000000000000004', () => expect(parseDollarsToCents('0.30')).toBe(30));
});
describe('allocation sums exactly and is deterministic', () => {
  it('100 cents over [1,1,1] → 34/33/33 (largest fraction first, ties by index)', () => expect(allocateByLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]));
  it('sums exactly for awkward weights', () => { const out = allocateByLargestRemainder(1001, [3, 7, 11, 2]); expect(out.reduce((a, b) => a + b)).toBe(1001); });
  it('no weights → all on the first', () => expect(allocateByLargestRemainder(50, [0, 0])).toEqual([50, 0]));
  it('empty → empty', () => expect(allocateByLargestRemainder(50, [])).toEqual([]));
});

// ONE-TAX (Oct 21 2026): the one sales-tax helper
describe('taxCents', () => {
  it('rounds taxable × rate / 100 to whole cents, half up', () => {
    expect(taxCents(10000, 7.75)).toBe(775);
    expect(taxCents(1999, 6.625)).toBe(132);    // 132.43…
    expect(taxCents(1, 50)).toBe(1);            // 0.5 → 1
  });
  it('a rate that is not a finite non-negative number, a zero rate, or nothing taxable → 0', () => {
    expect(taxCents(10000, 0)).toBe(0);
    expect(taxCents(10000, NaN)).toBe(0);
    expect(taxCents(10000, -5)).toBe(0);
    expect(taxCents(0, 7.75)).toBe(0);
    expect(taxCents(-500, 7.75)).toBe(0);
  });
});
