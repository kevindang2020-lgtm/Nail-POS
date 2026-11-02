// tenant-receptionist.vitest.spec.ts — the tenant-facing overview. Verifies it reuses the real analytics service,
// reports providers honestly as not-connected (no fabricated "live"), and derives the setup checklist + progress
// from real signals (store hours, issued key, write-tools flag).
import { describe, it, expect, vi } from 'vitest';
import { TenantReceptionistService } from './tenant-receptionist.service';

const ANALYTICS = { totalCalls: 0, booked: 0, bookingRatePct: null, handoffs: 0, handoffRatePct: null, abandoned: 0, abandonmentRatePct: null, toolFailureRatePct: null, callsWithToolFailure: 0, avgDurationSeconds: null, topIntents: [] };
const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] };

function svc(over: any = {}) {
  const outcomes = over.outcomes ?? { summary: vi.fn(async () => ANALYTICS), list: vi.fn(async () => []) };
  const keys = over.keys ?? { list: vi.fn(async () => []) };
  const branchInfo = over.branchInfo ?? { storeHours: vi.fn(async () => ({ timezone: 'America/New_York', storeHours: { monday: { isOpen: true, openTime: '09:00', closeTime: '19:00' } } })) };
  return new TenantReceptionistService(outcomes as any, keys as any, branchInfo as any);
}

describe('TenantReceptionistService.overview', () => {
  it('reuses the real analytics service and never fabricates provider connections', async () => {
    delete process.env.VOICE_WRITE_TOOLS_ENABLED;
    const o = await svc().overview(ctx as any);
    expect(o.analytics).toEqual(ANALYTICS);                 // real analytics, passed through
    expect(o.providers).toMatchObject({ voiceAgent: 'not_connected', telephony: 'not_connected' }); // honest — no account wired
    expect(o.providers.voiceAgentDetail).toBeTruthy();       // a specific, credential-derived reason (not a bare literal)
    expect(o.frontDeskStatus).toBe('setup');                // hours configured but no key issued yet → still setup
  });

  it('marks business setup done when hours are configured, action_needed when not', async () => {
    const withHours = await svc().overview(ctx as any);
    expect(withHours.checklist.find((c) => c.key === 'business_setup')!.state).toBe('done');
    const noHours = await svc({ branchInfo: { storeHours: vi.fn(async () => ({ timezone: null, storeHours: {} })) } }).overview(ctx as any);
    expect(noHours.checklist.find((c) => c.key === 'business_setup')!.state).toBe('action_needed');
  });

  it('reflects an issued (non-revoked) key and the write-tools flag honestly', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    try {
      const o = await svc({ keys: { list: vi.fn(async () => [{ revokedMs: null }]) } }).overview(ctx as any);
      expect(o.keyIssued).toBe(true);
      expect(o.checklist.find((c) => c.key === 'integration_key')!.state).toBe('done');
      expect(o.writeToolsEnabled).toBe(true);
      expect(o.checklist.find((c) => c.key === 'write_tools')!.state).toBe('done');
    } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; }
    // a revoked key does not count as issued
    const revoked = await svc({ keys: { list: vi.fn(async () => [{ revokedMs: Date.now() }]) } }).overview(ctx as any);
    expect(revoked.keyIssued).toBe(false);
  });

  it('computes setup progress from completed checklist items', async () => {
    const o = await svc().overview(ctx as any);
    const done = o.checklist.filter((c) => c.state === 'done').length;
    expect(o.setupProgressPct).toBe(Math.round((done / o.checklist.length) * 100));
  });

  it('recentCalls is server-scoped to the tenant and bounded', async () => {
    const list = vi.fn(async () => []);
    await svc({ outcomes: { summary: vi.fn(async () => ANALYTICS), list } }).recentCalls(ctx as any, 999);
    expect(list).toHaveBeenCalledWith('t1', { branchId: 'b1', limit: 50 }); // clamped to 50
  });
});
