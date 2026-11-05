import { describe, it, expect } from 'vitest';
import { hexToRgb, luminance, contrastRatio, readableTextColor, bestContrast, colorContrastWarning } from './contrast';

describe('contrast', () => {
  it('parses #RRGGBB and #RGB', () => {
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255]);
    expect(hexToRgb('000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#A96F22')).toEqual([169, 111, 34]);
    expect(hexToRgb('nope')).toBeNull();
  });
  it('luminance ordering white > mid > black', () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(luminance([169, 111, 34])).toBeGreaterThan(0);
    expect(luminance([169, 111, 34])).toBeLessThan(1);
  });
  it('contrast ratio black vs white is 21:1', () => {
    expect(contrastRatio(luminance([0, 0, 0]), luminance([255, 255, 255]))).toBeCloseTo(21, 1);
  });
  it('picks readable text color', () => {
    expect(readableTextColor('#111111')).toBe('#FFFFFF'); // dark bg → white text
    expect(readableTextColor('#FFFBEF')).toBe('#1A1208'); // light bg → dark text
  });
  it('warns when a swatch is too close to the cream page, passes strong colors', () => {
    expect(colorContrastWarning('')).toBeNull();
    expect(colorContrastWarning('#ZZZ')).toMatch(/valid hex/i);
    expect(colorContrastWarning('#111111')).toBeNull();      // dark — stands out on cream
    expect(colorContrastWarning('#A96F22')).toBeNull();      // brand gold — stands out
    expect(colorContrastWarning('#FFFFFF')).not.toBeNull();  // white blends into cream page
    expect(colorContrastWarning('#FBF6EC')).not.toBeNull();  // near-cream — hard to see
    expect(bestContrast('#000000')).toBeCloseTo(21, 1);
  });
});
