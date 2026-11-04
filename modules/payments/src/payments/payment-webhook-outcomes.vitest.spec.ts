// payment-webhook-outcomes.vitest.spec — Settlements guide (Nov 4 2026): a webhook stores what the processor SAID happened.
//   • a refund event is refunded / failed / pending / cancelled by its own status (any "refund" event used to be "refunded")
//   • a settlement batch is settled / failed / returned / pending
//   • settled_at is the processor's settlement time, not the time the callback arrived
import { describe, it, expect } from 'vitest';
import { mapRefundStatus, mapSettlementStatus, providerTime } from './payment-webhook.service';

describe('refund outcome', () => {
  it.each([
    ['refund.completed', {}, 'refunded'],
    ['refund', {}, 'refunded'],
    ['refund.failed', {}, 'failed'],
    ['refund_declined', {}, 'failed'],
    ['refund.pending', {}, 'pending'],
    ['refund.created', {}, 'pending'],
    ['refund.cancelled', {}, 'cancelled'],
    ['refund', { status: 'FAILED' }, 'failed'],
    ['refund.updated', { status: 'succeeded' }, 'refunded'],
  ])('%s %j → %s', (e, body, want) => expect(mapRefundStatus(e, body)).toBe(want));
});

describe('settlement outcome', () => {
  it.each([
    ['settlement.completed', {}, 'settled'],
    ['batch', {}, 'settled'],
    ['settlement.failed', {}, 'failed'],
    ['batch.rejected', {}, 'failed'],
    ['settlement.returned', {}, 'returned'],
    ['batch', { status: 'pending' }, 'pending'],
  ])('%s %j → %s', (e, body, want) => expect(mapSettlementStatus(e, body)).toBe(want));
});

describe('provider settlement time', () => {
  it('reads ISO, yyyymmdd and epoch; ignores junk and the far future', () => {
    expect(providerTime({ settledAt: '2026-11-02T03:15:00Z' }, ['settledAt'])).toBe('2026-11-02T03:15:00.000Z');
    expect(providerTime({ batchDate: '20261102' }, ['settledAt', 'batchDate'])).toBe('2026-11-02T12:00:00.000Z');
    expect(providerTime({ date: 1793000000 }, ['date'])).toBe(new Date(1793000000 * 1000).toISOString());
    expect(providerTime({ settledAt: 'soon' }, ['settledAt'])).toBeNull();
    expect(providerTime({ settledAt: '2099-01-01' }, ['settledAt'])).toBeNull();
    expect(providerTime({}, ['settledAt'])).toBeNull();
  });
});
