import { describe, it, expect, vi } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';

// Owner AI Center delegates to the canonical AiCenterService.overview (which honestly flags each metric tracked/untracked)
// with the owner's branch scope. Gated by 'owner.dashboard.view'. These tests cover the gate, the delegation with the
// resolved scope, and the unavailable guard when the service isn't wired.
const ctx = (perms: string[]): OwnerContext => ({ tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: perms } as any);

const fakeOverview = { generatedAt: '2026-06-27T15:00:00.000Z', kpis: { aiCallsHandled: { tracked: true, value: 42, source: 'call_intelligence_events' } }, sections: [], activity: [], callIntelligence: {}, bookingAssistant: {}, automation: {}, live: {} } as any;

class FakeAi {
  overview = vi.fn(async (_ctx: any) => fakeOverview);
}
class FakeRepo extends InMemoryOwnerRepository {
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
}

describe('Owner AI Center — delegates to AiCenterService', () => {
  it('blocks a user without owner.dashboard.view', async () => {
    const svc = new OwnerService(new FakeRepo(), undefined, undefined, new FakeAi() as any);
    await expect(svc.aiCenterOverview(ctx(['owner.settings.view']))).rejects.toThrow(/permission/i);
  });

  it('delegates to AiCenterService.overview with the owner branch scope (null for full owner)', async () => {
    const ai = new FakeAi();
    const svc = new OwnerService(new FakeRepo(), undefined, undefined, ai as any);
    const out = await svc.aiCenterOverview(ctx(['owner.dashboard.view']));
    expect(ai.overview).toHaveBeenCalledTimes(1);
    const passed = ai.overview.mock.calls[0][0];
    expect(passed.tenantId).toBe('t1');
    expect(passed.branchId).toBeNull();
    expect(out.kpis.aiCallsHandled.value).toBe(42);
  });

  it('reports unavailable when the AI Center service is not wired', async () => {
    const svc = new OwnerService(new FakeRepo());
    await expect(svc.aiCenterOverview(ctx(['owner.dashboard.view']))).rejects.toThrow(/unavailable/i);
  });
});
