// date-range.vitest.spec.ts — Scaling Phase 1.10 (§10 query range caps): the shared date-range validator.
import { describe, it, expect } from 'vitest';
import { validateDateRange, diffInDays, DateRangeError, MAX_RANGE_DAYS } from './date-range';

describe('validateDateRange', () => {
  it('allows an in-cap custom range', () => {
    const { fromMs, toMs } = validateDateRange('2026-06-01', '2026-06-30', 'reports');
    expect(fromMs).not.toBeNull();
    expect(toMs).not.toBeNull();
  });

  it('rejects a range wider than the reports cap (90 days) with an export-job hint', () => {
    expect(() => validateDateRange('2018-01-01', '2026-07-03', 'reports')).toThrow(DateRangeError);
    try { validateDateRange('2018-01-01', '2026-07-03', 'reports'); } catch (e: any) {
      expect(e.message).toMatch(/export job/i);
      expect(e.message).toContain(String(MAX_RANGE_DAYS.reports));
    }
  });

  it('applies the tighter appointments cap (31 days)', () => {
    expect(() => validateDateRange('2026-01-01', '2026-03-01', 'appointments')).toThrow(/31 days/);
    expect(validateDateRange('2026-01-01', '2026-01-30', 'appointments').fromMs).not.toBeNull();
  });

  it('rejects an inverted range', () => {
    expect(() => validateDateRange('2026-06-30', '2026-06-01', 'reports')).toThrow(/end date/i);
  });

  it('rejects a one-sided (effectively unbounded) range', () => {
    expect(() => validateDateRange('2020-01-01', undefined, 'transactions')).toThrow(DateRangeError);
    expect(() => validateDateRange(undefined, '2026-07-03', 'transactions')).toThrow(DateRangeError);
  });

  it('treats both-absent as no range (allowed) unless requireBoth is set', () => {
    expect(validateDateRange(undefined, undefined, 'reports')).toEqual({ fromMs: null, toMs: null });
    expect(() => validateDateRange(undefined, undefined, 'reports', { requireBoth: true })).toThrow(/required/i);
  });

  it('diffInDays is whole-day and never negative', () => {
    expect(diffInDays(Date.parse('2026-06-01'), Date.parse('2026-06-11'))).toBe(10);
    expect(diffInDays(Date.parse('2026-06-11'), Date.parse('2026-06-01'))).toBe(0);
  });
});
