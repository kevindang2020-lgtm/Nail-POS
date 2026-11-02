import { describe, it, expect } from 'vitest';
import { computeUpsellCapturePercent } from './checkout.dto';

describe('checkout computeUpsellCapturePercent', () => {
  it('returns 0 when there are no paid tickets', () => {
    expect(computeUpsellCapturePercent(0, 0)).toBe(0);
    expect(computeUpsellCapturePercent(4, 0)).toBe(0);
  });

  it('computes the share of paid tickets carrying an add-on', () => {
    expect(computeUpsellCapturePercent(3, 12)).toBe(25);
    expect(computeUpsellCapturePercent(6, 12)).toBe(50);
  });

  it('rounds to a whole percent', () => {
    expect(computeUpsellCapturePercent(1, 3)).toBe(33);
    expect(computeUpsellCapturePercent(2, 3)).toBe(67);
  });

  it('returns 100 when every paid ticket had an add-on', () => {
    expect(computeUpsellCapturePercent(9, 9)).toBe(100);
  });
});
