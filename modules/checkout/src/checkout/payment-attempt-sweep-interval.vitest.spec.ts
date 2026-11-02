// payment-attempt-sweep-interval.vitest.spec.ts — §68 (Oct 27 2026): the stranded sweep's tick is five minutes; the pilot day
// may shorten it OUTSIDE production only (PAYMENT_ATTEMPT_SWEEP_EVERY_MS), never below one second.
import { describe, it, expect } from 'vitest';
import { sweepEveryMs, SWEEP_EVERY_MS, paymentAttemptSweepEnabled } from './payment-attempt-sweep.scheduler';

describe('sweepEveryMs', () => {
  it('defaults to five minutes; a development override is honoured, clamped to ≥ 1 s', () => {
    expect(sweepEveryMs({} as any)).toBe(SWEEP_EVERY_MS);
    expect(sweepEveryMs({ PAYMENT_ATTEMPT_SWEEP_EVERY_MS: '15000', NODE_ENV: 'development' } as any)).toBe(15000);
    expect(sweepEveryMs({ PAYMENT_ATTEMPT_SWEEP_EVERY_MS: '10', NODE_ENV: 'development' } as any)).toBe(1000);
    expect(sweepEveryMs({ PAYMENT_ATTEMPT_SWEEP_EVERY_MS: 'abc' } as any)).toBe(SWEEP_EVERY_MS);
  });
  it('is ignored in production', () => {
    expect(sweepEveryMs({ PAYMENT_ATTEMPT_SWEEP_EVERY_MS: '15000', NODE_ENV: 'production' } as any)).toBe(SWEEP_EVERY_MS);
  });
  it('the switch is unchanged (off only by PAYMENT_ATTEMPT_SWEEP=off)', () => {
    expect(paymentAttemptSweepEnabled({} as any)).toBe(true);
    expect(paymentAttemptSweepEnabled({ PAYMENT_ATTEMPT_SWEEP: 'off' } as any)).toBe(false);
  });
});
