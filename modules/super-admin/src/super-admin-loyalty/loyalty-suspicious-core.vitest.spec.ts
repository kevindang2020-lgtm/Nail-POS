import { describe, it, expect } from 'vitest';
import { severityForVelocity, severityForValue, severityForRepeat, bucketKey, canTransition, DETECTION_DEFAULTS } from './loyalty-suspicious-core';

describe('loyalty suspicious core', () => {
  it('grades velocity severity by count', () => {
    expect(severityForVelocity(4)).toBe('low');
    expect(severityForVelocity(5)).toBe('medium');
    expect(severityForVelocity(10)).toBe('high');
  });
  it('grades high-value severity by points', () => {
    expect(severityForValue(4999)).toBe('low');
    expect(severityForValue(5000)).toBe('medium');
    expect(severityForValue(10000)).toBe('high');
  });
  it('grades rapid-repeat severity by count', () => {
    expect(severityForRepeat(2)).toBe('low');
    expect(severityForRepeat(3)).toBe('medium');
    expect(severityForRepeat(6)).toBe('high');
  });
  it('bucketKey is stable per tenant/customer/signal/day (idempotency)', () => {
    const a = bucketKey('t', 'c', 'velocity', '2026-05-06T10:00:00Z');
    const b = bucketKey('t', 'c', 'velocity', '2026-05-06T22:00:00Z');
    expect(a).toBe(b);   // same day ⇒ same bucket
    expect(bucketKey('t', 'c', 'velocity', '2026-05-07T00:00:00Z')).not.toBe(a);
  });
  it('enforces the status flow', () => {
    expect(canTransition('open', 'reviewing')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'open')).toBe(false);   // terminal
    expect(canTransition('dismissed', 'reviewing')).toBe(false);
    void DETECTION_DEFAULTS;
  });
});
