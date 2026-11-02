import { describe, it, expect } from 'vitest';
import { applyAiBillingEvent } from './ai-subscription-billing-core';
import { InMemoryAiSubscriptionBillingRepo } from './ai-subscription-billing.repository';
import { AiSubscriptionBillingService } from './ai-subscription-billing.service';

describe('applyAiBillingEvent (state machine)', () => {
  it('a successful charge activates from past_due/unpaid/trialing', () => {
    for (const s of ['past_due', 'unpaid', 'trialing'] as const) {
      const t = applyAiBillingEvent(s, 'payment_succeeded');
      expect(t).toMatchObject({ ok: true, changed: true, status: 'active', setPeriod: true, lastPaymentStatus: 'succeeded' });
    }
  });
  it('a failed payment moves active → past_due', () => {
    expect(applyAiBillingEvent('active', 'payment_failed')).toMatchObject({ status: 'past_due', changed: true, lastPaymentStatus: 'failed' });
  });
  it('refund/chargeback move to unpaid (blocks access)', () => {
    expect(applyAiBillingEvent('active', 'refunded').status).toBe('unpaid');
    expect(applyAiBillingEvent('active', 'chargeback').status).toBe('unpaid');
  });
  it('cancellation and trial expiry are terminal-ish and idempotent', () => {
    expect(applyAiBillingEvent('active', 'subscription_cancelled')).toMatchObject({ status: 'cancelled', setCancelled: true });
    expect(applyAiBillingEvent('cancelled', 'subscription_cancelled').changed).toBe(false);
    expect(applyAiBillingEvent('trialing', 'trial_expired').status).toBe('expired');
    expect(applyAiBillingEvent('active', 'trial_expired').changed).toBe(false); // not trialing → no-op
  });
  it("a failed event on a cancelled sub doesn't resurrect it", () => {
    expect(applyAiBillingEvent('cancelled', 'payment_failed')).toMatchObject({ changed: false, status: 'cancelled' });
  });
  it('rejects an unknown event', () => {
    expect(applyAiBillingEvent('active', 'nonsense' as any)).toMatchObject({ ok: false, reason: 'unknown_event' });
  });
});

describe('idempotent apply (repo)', () => {
  const ev = (over: any = {}) => ({ eventId: 'evt_1', tenantId: 't1', packageCode: 'ai_booking_assistant', eventType: 'payment_succeeded', ...over });

  it('applies once, then treats a re-delivered event as a duplicate no-op', async () => {
    const repo = new InMemoryAiSubscriptionBillingRepo();
    repo.subs.set('t1:ai_booking_assistant', 'past_due');
    const first = await repo.apply(ev());
    expect(first).toMatchObject({ applied: true, fromStatus: 'past_due', toStatus: 'active' });
    expect(repo.subs.get('t1:ai_booking_assistant')).toBe('active');
    const again = await repo.apply(ev()); // same eventId
    expect(again).toMatchObject({ applied: false, duplicate: true });
  });

  it('does nothing when there is no subscription for that tenant/package', async () => {
    const repo = new InMemoryAiSubscriptionBillingRepo();
    expect(await repo.apply(ev({ eventId: 'evt_2' }))).toMatchObject({ applied: false, reason: 'no_subscription' });
  });

  it('service rejects an invalid event and applies a valid one', async () => {
    const repo = new InMemoryAiSubscriptionBillingRepo();
    repo.subs.set('t1:ai_booking_assistant', 'trialing');
    const svc = new AiSubscriptionBillingService(repo, null);
    expect(await svc.applyEvent({ eventId: '', tenantId: 't1', packageCode: 'x', eventType: '' } as any)).toMatchObject({ applied: false, reason: 'invalid_event' });
    expect(await svc.applyEvent(ev({ eventId: 'evt_3', eventType: 'trial_converted' }))).toMatchObject({ applied: true, toStatus: 'active' });
  });
});
