// ai-provisioning.vitest.spec.ts — durable provisioning. Verifies: it fails HONESTLY at the provider step when the
// voice provider is not connected (no fake progress), it succeeds and flips the agent to ready with a mock connected
// provider, permission is enforced, and start() is idempotent (one active job per agent).
import { describe, it, expect, vi } from 'vitest';
import { AiProvisioningService, InMemoryProvJobRepo, ProvForbiddenError } from './ai-provisioning.service';
import { resolveVoiceProvider } from './provider-ports';

const owner = { tenantId: 't1', branchId: null, userId: 'u1', role: 'OWNER', permissions: ['ai.manage'] };
const viewer = { tenantId: 't1', branchId: null, userId: 'u2', role: 'RECEPTION', permissions: ['ai.use'] };
const agent = { id: 'agent_1', name: 'Main Front Desk', language: 'en', greeting: 'Hi', behavior: 'Be warm', useCase: null };

function make(voice: any) {
  const jobs = new InMemoryProvJobRepo();
  const setProvisioned = vi.fn(async () => {});
  const agents = { get: vi.fn(async () => agent), setProvisioned };
  return { svc: new AiProvisioningService(jobs as any, agents as any, voice), setProvisioned };
}
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('AiProvisioningService', () => {
  it('fails honestly at the provider step when the voice provider is not connected', async () => {
    const { svc } = make(resolveVoiceProvider({} as any)); // NotConnected
    const job = await svc.start(owner as any, 'agent_1');
    await settle();
    const done = await svc.get(owner as any, job.id);
    expect(done.status).toBe('failed');
    expect(done.errorCode).toBe('PROVIDER_NOT_CONNECTED');
    expect(done.safeErrorMessage).toMatch(/not connected/i);
    expect(done.progress).toBeLessThan(100);            // never fake-completed
  });

  it('succeeds and provisions the agent with a connected provider', async () => {
    const voice = { status: () => ({ state: 'connected', provider: 'retell', detail: '' }), createAgent: vi.fn(async () => ({ providerAgentId: 'ret_agent_9' })) };
    const { svc, setProvisioned } = make(voice);
    const job = await svc.start(owner as any, 'agent_1');
    await settle();
    const done = await svc.get(owner as any, job.id);
    expect(done.status).toBe('succeeded');
    expect(done.progress).toBe(100);
    expect(done.providerAgentId).toBe('ret_agent_9');
    expect(setProvisioned).toHaveBeenCalledWith('t1', 'agent_1', 'ret_agent_9');
  });

  it('requires ai.manage', async () => {
    const { svc } = make(resolveVoiceProvider({} as any));
    await expect(svc.start(viewer as any, 'agent_1')).rejects.toBeInstanceOf(ProvForbiddenError);
  });

  it('is idempotent \u2014 a second start returns the same active job', async () => {
    // a provider whose createAgent never resolves keeps the job active
    const voice = { status: () => ({ state: 'connected', provider: 'retell', detail: '' }), createAgent: () => new Promise(() => {}) };
    const { svc } = make(voice);
    const a = await svc.start(owner as any, 'agent_1');
    const b = await svc.start(owner as any, 'agent_1');
    expect(b.id).toBe(a.id);
  });
});
