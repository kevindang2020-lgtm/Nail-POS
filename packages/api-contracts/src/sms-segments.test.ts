import { describe, it, expect } from 'vitest';
import { estimateSmsSegments, LARGE_CAMPAIGN_RECIPIENTS } from './sms-segments';

describe('estimateSmsSegments (§77 / §81) — the billable unit, estimated the way carriers split', () => {
  it('GSM-7: 160 fits one segment; 161 is two; 306 is two; 307 is three', () => {
    expect(estimateSmsSegments('a'.repeat(160))).toMatchObject({ segments: 1, encoding: 'GSM-7' });
    expect(estimateSmsSegments('a'.repeat(161))).toMatchObject({ segments: 2, perSegment: 153 });
    expect(estimateSmsSegments('a'.repeat(306)).segments).toBe(2);
    expect(estimateSmsSegments('a'.repeat(307)).segments).toBe(3);
  });
  it('GSM-7 extension characters cost two (a 159-char text with two braces is two segments)', () => {
    expect(estimateSmsSegments('a'.repeat(157) + '{}').segments).toBe(2);
  });
  it('UCS-2 (an emoji or Vietnamese diacritics): 70 fits one; 71 is two', () => {
    expect(estimateSmsSegments('Cảm ơn bạn ' + 'a'.repeat(59))).toMatchObject({ segments: 1, encoding: 'UCS-2' });
    expect(estimateSmsSegments('Cảm ơn bạn ' + 'a'.repeat(60)).segments).toBe(2);
    expect(estimateSmsSegments('💅'.repeat(36)).segments).toBe(2);   // 72 UTF-16 units
  });
  it('empty text is zero segments; the large-campaign threshold is a positive number', () => {
    expect(estimateSmsSegments('').segments).toBe(0);
    expect(LARGE_CAMPAIGN_RECIPIENTS).toBeGreaterThan(0);
  });
});
