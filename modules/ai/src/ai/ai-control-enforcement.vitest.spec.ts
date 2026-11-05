// AI control-mode enforcement (spec §3 Mode 1): a 'disabled' assistant cannot run — blocked on the backend before any
// provider call, logged as a permission block, no charge. An unset/other mode leaves the normal access path unchanged.
import { describe, it, expect } from 'vitest';
import { AiAssistantService, InMemoryAiAccessRepo } from './ai-assistant.service';
import { AiGatewayService, MockAiProvider, InMemoryAiUsageLogger } from './ai-gateway';

const req = { tenantId: 't1', userId: 'u1', packageCode: 'ai_business_assistant', prompt: 'How were sales today?' };

describe('AI control-mode enforcement', () => {
  it("blocks a disabled assistant before the provider, logged as permission block", async () => {
    const logger = new InMemoryAiUsageLogger();
    const svc = new AiAssistantService(new InMemoryAiAccessRepo(), new AiGatewayService(new MockAiProvider()), logger, async () => 'disabled');
    const r = await svc.run(req as any);
    expect(r.ok).toBe(false);
    expect(r.decision.reason).toBe('package_disabled');
    expect(logger.entries[0].status).toBe('blocked_permission');
    expect(logger.entries[0].errorMessage).toContain('control_mode_disabled');
    expect(logger.entries[0].usageAmount).toBe(0); // no charge
  });

  it("does NOT take the disabled path for a non-disabled mode (normal access applies)", async () => {
    const logger = new InMemoryAiUsageLogger();
    const svc = new AiAssistantService(new InMemoryAiAccessRepo(), new AiGatewayService(new MockAiProvider()), logger, async () => 'recommendation_only');
    const r = await svc.run(req as any);
    expect(r.ok).toBe(false);
    expect(r.decision.reason).toBe('not_subscribed');     // default-deny access path, not the disabled branch
    expect(logger.entries[0].status).toBe('blocked_unpaid');
  });

  it("is backward-compatible: no control lookup leaves behavior unchanged", async () => {
    const logger = new InMemoryAiUsageLogger();
    const svc = new AiAssistantService(new InMemoryAiAccessRepo(), new AiGatewayService(new MockAiProvider()), logger);
    const r = await svc.run(req as any);
    expect(r.ok).toBe(false);
    expect(r.decision.reason).toBe('not_subscribed');
  });
});
