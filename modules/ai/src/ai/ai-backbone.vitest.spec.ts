// AI backbone — catalog integrity, access-gate decisions across every status, and the assistant orchestration
// (gate → gateway → usage log) including default-deny, allow, limit, overage, and provider-error paths.
import { describe, it, expect } from 'vitest';
import { AI_PACKAGES, AI_PACKAGE_CODES, getAiPackage } from './ai-catalog';
import { evaluateAiAccess, type AiAccessSnapshot } from './ai-access-gate';
import { AiAssistantService, InMemoryAiAccessRepo } from './ai-assistant.service';
import { AiGatewayService, MockAiProvider, InMemoryAiUsageLogger, type AiProvider } from './ai-gateway';

const snap = (over: Partial<AiAccessSnapshot> = {}): AiAccessSnapshot => ({
  tenantStatus: 'active', packageEnabled: true,
  subscription: { status: 'active' }, usage: { used: 0, limit: 100, overageEnabled: false }, hasPermission: true, ...over,
});

describe('ai-catalog', () => {
  it('defines exactly the 15 assistant packages with unique codes', () => {
    expect(AI_PACKAGES).toHaveLength(15);
    expect(new Set(AI_PACKAGE_CODES).size).toBe(15);
    expect(getAiPackage('ai_booking_assistant')?.name).toBe('AI Booking Assistant');
    for (const p of AI_PACKAGES) { expect(p.monthlyPriceCents).toBeGreaterThan(0); expect(p.includedUsageLimit).toBeGreaterThan(0); }
  });
});

describe('evaluateAiAccess', () => {
  it('allows an active paid subscription within limit', () => {
    const d = evaluateAiAccess(snap());
    expect(d.allowed).toBe(true); expect(d.reason).toBe('ok'); expect(d.remainingUsage).toBe(100);
  });
  it('blocks when there is no subscription (upgrade required)', () => {
    const d = evaluateAiAccess(snap({ subscription: null }));
    expect(d.allowed).toBe(false); expect(d.reason).toBe('not_subscribed'); expect(d.upgradeRequired).toBe(true);
  });
  it('honors trial window', () => {
    const future = new Date(Date.now() + 86400000), past = new Date(Date.now() - 86400000);
    expect(evaluateAiAccess(snap({ subscription: { status: 'trialing', trialEndsAt: future } })).allowed).toBe(true);
    const expired = evaluateAiAccess(snap({ subscription: { status: 'trialing', trialEndsAt: past } }));
    expect(expired.allowed).toBe(false); expect(expired.reason).toBe('trial_expired');
  });
  it('blocks unpaid/cancelled/expired/disabled/suspended', () => {
    for (const [status, reason] of [['unpaid', 'unpaid'], ['cancelled', 'cancelled'], ['expired', 'expired'], ['disabled', 'package_disabled'], ['suspended', 'subscription_suspended']] as const) {
      const d = evaluateAiAccess(snap({ subscription: { status } }));
      expect(d.allowed).toBe(false); expect(d.reason).toBe(reason);
    }
  });
  it('past_due respects the Super-Admin policy', () => {
    expect(evaluateAiAccess(snap({ subscription: { status: 'past_due' }, pastDuePolicy: 'block' })).reason).toBe('past_due');
    expect(evaluateAiAccess(snap({ subscription: { status: 'past_due' }, pastDuePolicy: 'limit' })).allowed).toBe(true);
  });
  it('blocks a suspended/cancelled tenant unless support mode', () => {
    expect(evaluateAiAccess(snap({ tenantStatus: 'suspended' })).reason).toBe('tenant_not_active');
    expect(evaluateAiAccess(snap({ tenantStatus: 'suspended', supportMode: true })).allowed).toBe(true);
    expect(evaluateAiAccess(snap({ tenantStatus: 'cancelled', supportMode: true })).reason).toBe('tenant_not_active');
  });
  it('blocks a disabled package and missing permission', () => {
    expect(evaluateAiAccess(snap({ packageEnabled: false })).reason).toBe('package_disabled');
    expect(evaluateAiAccess(snap({ hasPermission: false })).reason).toBe('permission_denied');
  });
  it('enforces usage limit unless overage is enabled', () => {
    expect(evaluateAiAccess(snap({ usage: { used: 100, limit: 100, overageEnabled: false } })).reason).toBe('limit_exceeded');
    const over = evaluateAiAccess(snap({ usage: { used: 100, limit: 100, overageEnabled: true } }));
    expect(over.allowed).toBe(true); expect(over.limitExceeded).toBe(true);
    expect(evaluateAiAccess(snap({ usage: { used: 5, limit: 0, overageEnabled: false } })).allowed).toBe(true); // 0 = unlimited
  });
});

describe('AiAssistantService', () => {
  const mk = (repo: InMemoryAiAccessRepo, provider: AiProvider = new MockAiProvider()) => {
    const logger = new InMemoryAiUsageLogger();
    const svc = new AiAssistantService(repo, new AiGatewayService(provider), logger);
    return { svc, logger };
  };
  it('default-denies (closed unless a paid subscription is proven)', async () => {
    const { svc, logger } = mk(new InMemoryAiAccessRepo());
    const r = await svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_business_assistant', prompt: 'How were sales today?' });
    expect(r.ok).toBe(false); expect(r.decision.reason).toBe('not_subscribed');
    expect(logger.entries[0].status).toBe('blocked_unpaid'); // logged, no provider call
  });
  it('runs the provider + logs success when access is granted', async () => {
    const repo = new InMemoryAiAccessRepo();
    repo.seed('t1', 'ai_business_assistant', snap());
    const { svc, logger } = mk(repo);
    const r = await svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_business_assistant', prompt: 'Summarize today' });
    expect(r.ok).toBe(true); expect(r.text).toContain('[mock'); expect(logger.entries[0].status).toBe('success');
    expect(logger.entries[0].inputTokens).toBeGreaterThan(0);
  });
  it('rejects an unknown package with 404', async () => {
    const { svc } = mk(new InMemoryAiAccessRepo());
    await expect(svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'not_a_real_package', prompt: 'x' })).rejects.toMatchObject({ status: 404 });
  });
  it('logs provider_error and surfaces 502 when the provider throws', async () => {
    const repo = new InMemoryAiAccessRepo();
    repo.seed('t1', 'ai_business_assistant', snap());
    const boom: AiProvider = { name: 'boom', model: 'x', async complete() { throw new Error('upstream down'); } };
    const { svc, logger } = mk(repo, boom);
    await expect(svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_business_assistant', prompt: 'x' })).rejects.toMatchObject({ status: 502 });
    expect(logger.entries[0].status).toBe('provider_error');
  });
});
