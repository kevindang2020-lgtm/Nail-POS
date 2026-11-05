import { describe, it, expect } from 'vitest';
import {
  canTransition, assertTransition, InvalidTransitionError, isTerminal, isSuccess,
  blocksNewAttempt, isRetryable, isValidState, type PaymentAttemptState,
} from './payment-attempt-state';
import { computeTip, validateSplitPlan } from './mobile-tip-split';
import { decideProceed } from './mobile-proceed';

describe('payment-attempt state machine', () => {
  it('walks the full happy path with only valid transitions', () => {
    const path: PaymentAttemptState[] = [
      'created', 'readiness_checking', 'ready', 'reader_initializing', 'awaiting_customer_tap',
      'card_detected', 'authorization_pending', 'authorized', 'confirmation_pending', 'confirmed',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it('rejects invalid jumps', () => {
    expect(canTransition('created', 'confirmed')).toBe(false);
    expect(canTransition('authorization_pending', 'confirmed')).toBe(false); // must pass through authorized
    expect(() => assertTransition('created', 'authorized')).toThrow(InvalidTransitionError);
  });

  it('allows retry from declined/failed and reconciliation from unknown', () => {
    expect(canTransition('declined', 'ready')).toBe(true);
    expect(canTransition('failed', 'ready')).toBe(true);
    expect(canTransition('unknown', 'reconciliation_required')).toBe(true);
    expect(canTransition('reconciliation_required', 'confirmed')).toBe(true);
  });

  it('terminal states have no exits', () => {
    for (const t of ['canceled', 'voided', 'refunded'] as PaymentAttemptState[]) {
      expect(isTerminal(t)).toBe(true);
      expect(canTransition(t, 'ready')).toBe(false);
    }
  });

  it('predicates: success / in-flight (blocks a new attempt) / retryable / validity', () => {
    expect(isSuccess('confirmed')).toBe(true);
    expect(isSuccess('declined')).toBe(false);
    // a result that is pending or unknown blocks a second card attempt for the same balance
    for (const s of ['authorization_pending', 'authorized', 'confirmation_pending', 'unknown', 'reconciliation_required'] as PaymentAttemptState[]) {
      expect(blocksNewAttempt(s)).toBe(true);
    }
    expect(blocksNewAttempt('declined')).toBe(false); // a clean decline frees a retry
    expect(isRetryable('declined')).toBe(true);
    expect(isRetryable('failed')).toBe(true);
    expect(isRetryable('confirmed')).toBe(false);
    expect(isValidState('confirmed')).toBe(true);
    expect(isValidState('nope')).toBe(false);
  });
});

describe('mobile tip presets', () => {
  it('none = 0; percentage presets match the canonical tipForPercent', () => {
    expect(computeTip(10000, 'none')).toEqual({ ok: true, tipCents: 0 });
    expect(computeTip(10000, 'p15').tipCents).toBe(1500);
    expect(computeTip(10000, 'p20').tipCents).toBe(2000);
    expect(computeTip(10000, 'p25').tipCents).toBe(2500);
  });
  it('custom tip: valid whole cents accepted; negative/fractional rejected', () => {
    expect(computeTip(10000, { customCents: 3000 })).toEqual({ ok: true, tipCents: 3000 });
    expect(computeTip(10000, { customCents: -1 }).ok).toBe(false);
    expect(computeTip(10000, { customCents: 12.5 }).ok).toBe(false);
  });
});

describe('mobile split-plan validation', () => {
  it('accepts segments that sum exactly to the balance', () => {
    const v = validateSplitPlan([{ amountCents: 4000, method: 'card' }, { amountCents: 6000, method: 'cash' }], 10000);
    expect(v.ok).toBe(true);
    expect(v.totalCents).toBe(10000);
    expect(v.remainingCents).toBe(0);
  });
  it('rejects overpay, underpay, negative segments, missing method, and empty plans', () => {
    expect(validateSplitPlan([{ amountCents: 11000, method: 'card' }], 10000).ok).toBe(false); // overpay
    expect(validateSplitPlan([{ amountCents: 4000, method: 'card' }], 10000).ok).toBe(false);  // underpay
    expect(validateSplitPlan([{ amountCents: -2000, method: 'card' }, { amountCents: 12000, method: 'cash' }], 10000).ok).toBe(false); // negative masking overcharge
    expect(validateSplitPlan([{ amountCents: 10000, method: '' }], 10000).ok).toBe(false);      // missing method
    expect(validateSplitPlan([], 10000).ok).toBe(false);                                         // empty
  });
});

describe('proceed-to-payment decision', () => {
  const ready = { canTakePayment: true, readinessOverall: 'ready', lockOwnedByCaller: true, balanceCents: 10000 };
  it('green when everything is ready and the caller holds the lock', () => {
    expect(decideProceed(ready).canProceed).toBe(true);
  });
  it('blocks when the ticket is already paid', () => {
    const d = decideProceed({ ...ready, balanceCents: 0 });
    expect(d.canProceed).toBe(false); expect(d.reason).toBe('already_paid');
  });
  it('blocks when the caller does not hold the lock', () => {
    const d = decideProceed({ ...ready, lockOwnedByCaller: false });
    expect(d.canProceed).toBe(false); expect(d.reason).toBe('lock_not_held');
  });
  it('blocks on an invalid tip or split', () => {
    expect(decideProceed({ ...ready, tip: { ok: false, tipCents: -1, reason: 'bad' } }).reason).toBe('invalid_tip');
    expect(decideProceed({ ...ready, split: { ok: false, totalCents: 1, remainingCents: 9999, errors: ['bad'] } }).reason).toBe('invalid_split');
  });
  it('blocks (truthfully) when Tap to Pay is not set up — reason surfaces the readiness status', () => {
    const d = decideProceed({ ...ready, canTakePayment: false, readinessOverall: 'tap_to_pay_setup_required' });
    expect(d.canProceed).toBe(false);
    expect(d.reason).toBe('tap_to_pay_setup_required');
  });
});
