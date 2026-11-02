// payment-webhook-topup.vitest.spec.ts — §15 / §16 / §58 (Oct 27 2026): which webhook events are CHARGE outcomes (and so may
// settle a wallet top-up intent) and how the webhook hands a top-up order to the wallet settler. The real-Postgres race
// with Verify / the sweep is wallet-topup.postgres-race.vitest.spec.ts.
import { describe, it, expect } from 'vitest';
import { chargeEventOutcome } from './payment-webhook.service';

describe('chargeEventOutcome', () => {
  it('respstat decides first (A approved · C declined · B neither)', () => {
    expect(chargeEventOutcome('transaction', { respstat: 'A' })).toEqual({ approved: true, declined: false });
    expect(chargeEventOutcome('transaction', { respstat: 'C' })).toEqual({ approved: false, declined: true });
    expect(chargeEventOutcome('transaction.approved', { respstat: 'B' })).toEqual({ approved: false, declined: false });
  });
  it('the event name / status when there is no respstat', () => {
    expect(chargeEventOutcome('payment.captured', {})).toEqual({ approved: true, declined: false });
    expect(chargeEventOutcome('authorization.declined', {})).toEqual({ approved: false, declined: true });
    expect(chargeEventOutcome('transaction.updated', { status: 'approved' })).toEqual({ approved: true, declined: false });
    expect(chargeEventOutcome('transaction.pending', {})).toEqual({ approved: false, declined: false });
  });
  it('refund / void / chargeback / settlement batch / onboarding events are never a charge outcome (they never settle a top-up)', () => {
    for (const e of ['refund.approved', 'transaction.voided', 'chargeback.created', 'dispute.won', 'settlement.batch', 'underwriting.approved']) expect(chargeEventOutcome(e, { respstat: 'A' })).toBeNull();
  });
});
