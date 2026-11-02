import { describe, it, expect } from 'vitest';
import { computeUtilizationPercent, computeUpsellCapturePercent } from './tech-queue.dto';

describe('computeUtilizationPercent', () => {
  it('returns 0 when there are no scheduled minutes (no shift data)', () => {
    expect(computeUtilizationPercent(120, 0)).toBe(0);
    expect(computeUtilizationPercent(0, 0)).toBe(0);
  });

  it('computes actual / scheduled as a whole percent', () => {
    expect(computeUtilizationPercent(240, 480)).toBe(50); // half a shift busy
    expect(computeUtilizationPercent(360, 480)).toBe(75);
  });

  it('caps at 100 when actual exceeds scheduled (e.g. partial shift data)', () => {
    expect(computeUtilizationPercent(600, 480)).toBe(100);
  });

  it('rounds to the nearest whole percent', () => {
    expect(computeUtilizationPercent(160, 480)).toBe(33); // 33.33
    expect(computeUtilizationPercent(320, 480)).toBe(67); // 66.67
  });

  it('treats negative actual minutes as 0', () => {
    expect(computeUtilizationPercent(-50, 480)).toBe(0);
  });
});

describe('computeUpsellCapturePercent', () => {
  it('returns 0 when there are no completed tickets', () => {
    expect(computeUpsellCapturePercent(0, 0)).toBe(0);
    expect(computeUpsellCapturePercent(3, 0)).toBe(0);
  });

  it('computes the share of tickets carrying an add-on', () => {
    expect(computeUpsellCapturePercent(3, 10)).toBe(30);
    expect(computeUpsellCapturePercent(5, 10)).toBe(50);
  });

  it('rounds to a whole percent', () => {
    expect(computeUpsellCapturePercent(1, 3)).toBe(33);
    expect(computeUpsellCapturePercent(2, 3)).toBe(67);
  });

  it('returns 100 when every completed ticket had an add-on', () => {
    expect(computeUpsellCapturePercent(8, 8)).toBe(100);
  });
});
