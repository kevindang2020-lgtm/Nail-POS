// provisioning-metrics.vitest.spec.ts — the in-process provisioning observability counters, and that the provisioning
// service records into them at the terminal states (honest: success rate null until settled attempts, failures keyed
// by error code).
import { describe, it, expect } from 'vitest';
import { ProvisioningMetricsService } from './provisioning-metrics.service';
import { AiProvisioningService, InMemoryProvJobRepo } from './ai-provisioning.service';
import { resolveVoiceProvider } from './provider-ports';

describe('ProvisioningMetricsService', () => {
  it('starts with a null success rate (no fabricated 100%)', () => {
    const m = new ProvisioningMetricsService();
    const s = m.snapshot();
    expect(s.successRatePct).toBeNull();
    expect(s.attempts).toBe(0);
  });

  it('computes a success rate and keys failures by code', () => {
    const m = new ProvisioningMetricsService();
    m.attempt(); m.success();
    m.attempt(); m.failure('PROVIDER_NOT_CONNECTED');
    m.attempt(); m.failure('PROVIDER_NOT_CONNECTED');
    const s = m.snapshot();
    expect(s).toMatchObject({ attempts: 3, succeeded: 1, failed: 2, successRatePct: 33 });
    expect(s.byErrorCode).toEqual({ PROVIDER_NOT_CONNECTED: 2 });
  });
});

const settle = () => new Promise((r) => setTimeout(r, 5));
const owner = { tenantId: 't1', branchId: null, userId: 'u1', role: 'OWNER', permissions: ['ai.manage'] };
const agent = { id: 'agent_1', name: 'A', language: 'en', greeting: 'hi', behavior: 'b' };

describe('provisioning records into metrics', () => {
  it('records a failure with the provider-not-connected code when not connected', async () => {
    const metrics = new ProvisioningMetricsService();
    const agents = { get: async () => agent, setProvisioned: async () => {} };
    const svc = new AiProvisioningService(new InMemoryProvJobRepo() as any, agents as any, resolveVoiceProvider({} as any), metrics);
    const job = await svc.start(owner as any, 'agent_1');
    await settle();
    // ensure it settled
    await svc.get(owner as any, job.id);
    const s = metrics.snapshot();
    expect(s.attempts).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.byErrorCode.PROVIDER_NOT_CONNECTED).toBe(1);
    expect(s.successRatePct).toBe(0);
  });

  it('records a success with a connected provider', async () => {
    const metrics = new ProvisioningMetricsService();
    const voice = { status: () => ({ state: 'connected', provider: 'retell', detail: '' }), createAgent: async () => ({ providerAgentId: 'ret_1' }) };
    const agents = { get: async () => agent, setProvisioned: async () => {} };
    const svc = new AiProvisioningService(new InMemoryProvJobRepo() as any, agents as any, voice as any, metrics);
    const job = await svc.start(owner as any, 'agent_1');
    await settle();
    await svc.get(owner as any, job.id);
    const s = metrics.snapshot();
    expect(s).toMatchObject({ succeeded: 1, failed: 0, successRatePct: 100 });
  });
});
