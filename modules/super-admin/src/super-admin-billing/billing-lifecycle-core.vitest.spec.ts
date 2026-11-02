import { describe, it, expect } from 'vitest';
import { resolveCancellation, resolvePause, canResume, LifecycleError } from './billing-lifecycle-core';

describe('resolveCancellation', () => {
  it('immediate cancels now', () => {
    expect(resolveCancellation('immediate', '2026-06-01').status).toBe('cancelled');
  });
  it('end_of_period schedules a pending cancellation at period end', () => {
    const r = resolveCancellation('end_of_period', '2026-06-01T00:00:00Z');
    expect(r.status).toBe('pending_cancellation');
    expect(r.effectiveAt.slice(0, 10)).toBe('2026-06-01');
  });
  it('rejects an unknown strategy', () => {
    expect(() => resolveCancellation('whenever', null)).toThrow(LifecycleError);
  });
});

describe('resolvePause / canResume', () => {
  it('pauses from an active-like status', () => {
    expect(resolvePause('active', '2026-07-01').status).toBe('paused');
  });
  it('rejects pausing a cancelled subscription', () => {
    expect(() => resolvePause('cancelled')).toThrow(LifecycleError);
  });
  it('resume only from paused', () => {
    expect(canResume('paused')).toBe(true);
    expect(canResume('active')).toBe(false);
  });
});
