import { describe, it, expect } from 'vitest';
import { computeRebookingRatePercent } from './service-done.dto';

describe('computeRebookingRatePercent', () => {
  it('returns null when no customers completed today', () => {
    // Service Done mandate §57 (Oct 28 2026): no completed guest = no rate (null), not 0 %
    expect(computeRebookingRatePercent([], [])).toBeNull();
    expect(computeRebookingRatePercent([null, undefined], ['c1'])).toBeNull();
  });

  it('counts each completed-today customer once and matches against future bookings', () => {
    // 4 distinct completed customers, 2 of them rebooked -> 50%
    const completed = ['c1', 'c2', 'c3', 'c4'];
    const rebooked = ['c1', 'c3'];
    expect(computeRebookingRatePercent(completed, rebooked)).toBe(50);
  });

  it('dedupes completed customers (multiple tickets same customer) before computing', () => {
    // c1 has 3 tickets today but is one distinct customer; c1 + c2 distinct, c1 rebooked -> 50%
    const completed = ['c1', 'c1', 'c1', 'c2'];
    const rebooked = ['c1'];
    expect(computeRebookingRatePercent(completed, rebooked)).toBe(50);
  });

  it('ignores rebooked ids that did not complete today (no over-count)', () => {
    const completed = ['c1', 'c2'];
    const rebooked = ['c1', 'c9', 'c8']; // c9/c8 not in the completed set
    expect(computeRebookingRatePercent(completed, rebooked)).toBe(50);
  });

  it('rounds to a whole percent', () => {
    // 1 of 3 -> 33.33 -> 33
    expect(computeRebookingRatePercent(['c1', 'c2', 'c3'], ['c2'])).toBe(33);
    // 2 of 3 -> 66.67 -> 67
    expect(computeRebookingRatePercent(['c1', 'c2', 'c3'], ['c1', 'c3'])).toBe(67);
  });

  it('returns 100 when every completed customer rebooked', () => {
    expect(computeRebookingRatePercent(['c1', 'c2'], ['c1', 'c2'])).toBe(100);
  });
});
