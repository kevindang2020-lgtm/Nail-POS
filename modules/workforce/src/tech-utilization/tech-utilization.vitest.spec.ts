import { describe, it, expect } from 'vitest';
import { computeUtilization } from './tech-utilization';

describe('computeUtilization (canonical clamp/round)', () => {
  it('returns null when there is no available time (never invents a denominator)', () => {
    expect(computeUtilization(120, 0)).toBeNull();
    expect(computeUtilization(0, 0)).toBeNull();
    expect(computeUtilization(60, -1 as any)).toBeNull();
  });
  it('rounds busy/available to a whole percent', () => {
    expect(computeUtilization(180, 480)).toBe(38); // 37.5 -> 38
    expect(computeUtilization(240, 480)).toBe(50);
  });
  it('clamps at 100 when busy exceeds available', () => {
    expect(computeUtilization(600, 480)).toBe(100);
  });
  it('is 0 when no busy minutes but a shift exists', () => {
    expect(computeUtilization(0, 480)).toBe(0);
  });
});
