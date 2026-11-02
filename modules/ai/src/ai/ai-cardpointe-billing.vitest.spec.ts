import { describe, it, expect } from 'vitest';
import { cardpointeChargeToBillingEvent } from './ai-cardpointe-billing';
import { InMemoryAiSubscriptionBillingRepo } from './ai-subscription-billing.repository';
import { AiSubscriptionBillingService } from './ai-subscription-billing.service';
import { selectRealProvider, OpenAiProvider } from './ai-providers';

const ctx = { tenantId: 't1', packageCode: 'ai_booking_assistant' as const };

describe('cardpointeChargeToBillingEvent', () => {
  it('approved charge → payment_succeeded, idempotent on retref', () => {
    const r = cardpointeChargeToBillingEvent({ retref: '123abc', respstat: 'A', resptext: 'Approval' }, ctx);
    expect(r.ok).toBe(true);
    expect((r as any).value).toMatchObject({ eventId: 'cardpointe:charge:123abc', eventType: 'payment_succeeded', provider: 'fiserv_cardpointe', tenantId: 't1', packageCode: 'ai_booking_assistant' });
  });
  it('declined charge → payment_failed; retry is held', () => {
    expect((cardpointeChargeToBillingEvent({ retref: 'r1', respstat: 'C' }, ctx) as any).value.eventType).toBe('payment_failed');
    expect(cardpointeChargeToBillingEvent({ retref: 'r1', respstat: 'B' }, ctx)).toMatchObject({ ok: false, reason: 'retry_pending' });
  });
  it('approved refund → refunded', () => {
    const r = cardpointeChargeToBillingEvent({ retref: 'r2', respstat: 'A' }, { ...ctx, kind: 'refund' });
    expect((r as any).value.eventType).toBe('refunded');
    expect((r as any).value.eventId).toBe('cardpointe:refund:r2');
  });
  it('rejects missing retref or context', () => {
    expect(cardpointeChargeToBillingEvent({ respstat: 'A' }, ctx)).toMatchObject({ ok: false, reason: 'missing_retref' });
    expect(cardpointeChargeToBillingEvent({ retref: 'x', respstat: 'A' }, { tenantId: '', packageCode: '' })).toMatchObject({ ok: false, reason: 'missing_context' });
  });
});

describe('service.applyCardpointeCharge', () => {
  it('an approved charge activates a past_due subscription', async () => {
    const repo = new InMemoryAiSubscriptionBillingRepo();
    repo.subs.set('t1:ai_booking_assistant', 'past_due');
    const svc = new AiSubscriptionBillingService(repo, null);
    const res = await svc.applyCardpointeCharge({ retref: 'cap789', respstat: 'A' }, ctx);
    expect(res).toMatchObject({ applied: true, fromStatus: 'past_due', toStatus: 'active' });
    expect(repo.subs.get('t1:ai_booking_assistant')).toBe('active');
    // resubmitting the same captured transaction is a no-op (retref idempotency)
    expect((await svc.applyCardpointeCharge({ retref: 'cap789', respstat: 'A' }, ctx)).applied).toBe(false);
  });
  it('a soft-decline (retry) makes no change', async () => {
    const repo = new InMemoryAiSubscriptionBillingRepo();
    repo.subs.set('t1:ai_booking_assistant', 'active');
    const svc = new AiSubscriptionBillingService(repo, null);
    expect(await svc.applyCardpointeCharge({ retref: 'r', respstat: 'B' }, ctx)).toMatchObject({ applied: false, reason: 'retry_pending' });
  });
});

describe('OpenAI default provider', () => {
  it('resolves to OpenAI gpt-4o-mini when only OPENAI_API_KEY is set', () => {
    const p = selectRealProvider({ OPENAI_API_KEY: 'sk-x' } as any);
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p!.model).toBe('gpt-4o-mini');
  });
  it('honors an explicit AI_DEFAULT_MODEL override', () => {
    const p = selectRealProvider({ AI_DEFAULT_PROVIDER: 'openai', AI_DEFAULT_MODEL: 'gpt-4o', OPENAI_API_KEY: 'sk-x' } as any);
    expect(p!.model).toBe('gpt-4o');
  });
});
