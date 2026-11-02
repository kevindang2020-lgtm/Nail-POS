import { describe, it, expect } from 'vitest';
import { computeAiCostMicroUsd, priceForModel, formatMicroUsd, DEFAULT_MODEL_PRICE } from './ai-pricing';
import { AiAssistantService, InMemoryAiAccessRepo } from './ai-assistant.service';
import { AiGatewayService, InMemoryAiUsageLogger, MockAiProvider } from './ai-gateway';

describe('ai-pricing', () => {
  it('computes micro-USD from tokens × per-model price', () => {
    // gpt-4o-mini: $0.15 / $0.60 per 1M. 1000 in + 500 out = 1000*0.15 + 500*0.60 = 150 + 300 = 450 micro-USD.
    expect(computeAiCostMicroUsd('gpt-4o-mini', 1000, 500)).toBe(450);
  });
  it('falls back to the default price for unknown models and is free for the mock', () => {
    expect(priceForModel('totally-unknown')).toEqual(DEFAULT_MODEL_PRICE);
    expect(computeAiCostMicroUsd('mock-1', 1000, 1000)).toBe(0);
  });
  it('formats micro-USD to a sub-cent dollar string', () => {
    expect(formatMicroUsd(500)).toBe('$0.0005');
    expect(formatMicroUsd(1_950_000)).toBe('$1.9500');
  });
});

describe('AiAssistantService cost logging', () => {
  const mk = () => {
    const repo = new InMemoryAiAccessRepo();
    const logger = new InMemoryAiUsageLogger();
    const svc = new AiAssistantService(repo as any, new AiGatewayService(new MockAiProvider()), logger);
    return { repo, logger, svc };
  };

  it('records a cost on a successful (allowed) call', async () => {
    const { repo, logger, svc } = mk();
    repo.seed('t1', 'ai_booking_assistant', { tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active', trialEndsAt: null }, usage: { used: 0, limit: 1000, overageEnabled: false }, hasPermission: true, pastDuePolicy: 'block' } as any);
    const r = await svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_booking_assistant', prompt: 'hi' });
    expect(r.ok).toBe(true);
    expect(logger.entries[0].status).toBe('success');
    expect(logger.entries[0]).toHaveProperty('costMicroUsd');
    expect(logger.entries[0].costMicroUsd).toBe(0); // mock provider is priced at 0
  });

  it('never records a cost on a blocked call', async () => {
    const { repo, logger, svc } = mk();
    repo.seed('t1', 'ai_booking_assistant', { tenantStatus: 'active', packageEnabled: true, subscription: null, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true, pastDuePolicy: 'block' } as any);
    const r = await svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_booking_assistant', prompt: 'hi' });
    expect(r.ok).toBe(false);
    expect(logger.entries[0].costMicroUsd).toBe(0);
    expect(logger.entries[0].status).not.toBe('success');
  });
});
