import { describe, it, expect } from 'vitest';
import { planCapture, planReconciliation, finalStateOf } from './capture-result';
import { InvalidTransitionError, type PaymentAttemptState } from './payment-attempt-state';

describe('planCapture', () => {
  it('plans the full approved path from ready to confirmed', () => {
    const plan = planCapture('ready', 'approved');
    expect(plan).toEqual(['reader_initializing', 'awaiting_customer_tap', 'card_detected', 'authorization_pending', 'authorized', 'confirmation_pending', 'confirmed']);
    expect(finalStateOf(plan, 'ready')).toBe('confirmed');
  });
  it('plans decline / timeout / unknown to their terminal-for-outcome state', () => {
    expect(finalStateOf(planCapture('ready', 'declined'), 'ready')).toBe('declined');
    expect(finalStateOf(planCapture('ready', 'timeout'), 'ready')).toBe('timed_out');
    expect(finalStateOf(planCapture('ready', 'unknown'), 'ready')).toBe('unknown');
  });
  it('accepts an attempt that already reported progress', () => {
    expect(planCapture('authorization_pending', 'approved')).toEqual(['authorized', 'confirmation_pending', 'confirmed']);
    expect(planCapture('authorized', 'approved')).toEqual(['confirmation_pending', 'confirmed']);
    expect(planCapture('authorization_pending', 'declined')).toEqual(['declined']);
  });
  it('rejects a result from a state outside the capture window, and every hop is state-machine valid', () => {
    expect(() => planCapture('created', 'approved')).toThrow(InvalidTransitionError);
    expect(() => planCapture('confirmed', 'approved')).toThrow(InvalidTransitionError);
    // a decline cannot come after authorization already succeeded
    expect(() => planCapture('authorized', 'declined')).toThrow(InvalidTransitionError);
  });
});

describe('planReconciliation', () => {
  it('resolves unknown / timed_out through reconciliation_required', () => {
    expect(planReconciliation('unknown', 'confirmed')).toEqual(['reconciliation_required', 'confirmed']);
    expect(planReconciliation('timed_out', 'declined')).toEqual(['reconciliation_required', 'declined']);
    expect(planReconciliation('unknown', 'voided')).toEqual(['reconciliation_required', 'voided']);
  });
  it('resolves an attempt already in reconciliation_required directly', () => {
    expect(planReconciliation('reconciliation_required', 'confirmed')).toEqual(['confirmed']);
  });
  it('rejects reconciliation from an inapplicable state', () => {
    expect(() => planReconciliation('confirmed' as PaymentAttemptState, 'confirmed')).toThrow(InvalidTransitionError);
    expect(() => planReconciliation('ready', 'confirmed')).toThrow(InvalidTransitionError);
  });
});
